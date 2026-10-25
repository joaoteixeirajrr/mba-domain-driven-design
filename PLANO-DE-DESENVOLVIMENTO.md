# Plano de Desenvolvimento — Lista de Espera de Ingressos

Feature: **cancelamento de pedido → liberação de lugar → promoção da fila de espera → notificação por e-mail**, toda ela orquestrada por eventos de domínio e uma política, com um evento de integração cruzando a fronteira para o `apps/emails`.

Este plano é derivado da leitura do `desafio.md` e do código real do monorepo. Cada etapa aponta os arquivos exatos que serão tocados ou criados.

---

## Progresso

- [x] **Etapa 1** — Ambiente e reconhecimento do terreno
- [x] **Etapa 2** — Design estratégico (`docs/linguagem-ubiqua.md`)
- [x] **Etapa 3** — Domínio com testes puros
- [x] **Etapa 4** — Persistência (schemas, custom types, repositórios)
- [x] **Etapa 5** — Comando de cancelamento (application service + REST)
- [x] **Etapa 6** — Handler de liberação de lugar
- [x] **Etapa 7** — Fila de espera (application service + REST)
- [x] **Etapa 8** — Política + evento de integração + consumo no `apps/emails`
- [x] **Etapa 9** — Testes finais (e2e em processo + regressão)
- [ ] **Etapa 10** — Fechamento (validação manual, api.http, docs, README)

---

## 0. Pré-requisitos e observações de acesso

- **Módulo da plataforma (`acesso.md`):** o link aponta para a plataforma Full Cycle, que exige login autenticado. Não é acessível por ferramentas automáticas; o conteúdo do curso (event storming, process/policies, eventos de domínio vs integração, carregamento de agregados) deve ser revisto manualmente na plataforma antes/durante o desenvolvimento. O desafio já traz os conceitos mapeados em cada requisito, então o plano está ancorado nesses conceitos.
- **Repositórios de referência** (consultar como apoio, não copiar):
  - https://github.com/AlenKaleb/mba-domain-driven-design
  - https://github.com/antoniobatista2025/mba-domain-driven-design
  - https://github.com/brunocamargos/mba-domain-driven-design
- **Entrega:** fork público do repositório base, tudo consolidado na branch `main`.

---

## 1. Ambiente e reconhecimento do terreno

Objetivo: rodar o projeto como ele é hoje e entender o "cano" que já existe antes de escrever qualquer linha.

1. `docker-compose up -d` — sobe MySQL, Redis e RabbitMQ.
2. `npm install`.
3. Preparar o banco: `npx mikro-orm schema:fresh --run` (recria todas as tabelas, inclusive `stored_event`).
4. Subir a API principal: `npm run start:dev` (porta 3000).
5. Subir o app de e-mails: `npx nest start emails` (porta 3001).
6. Percorrer o `api.http`: criar parceiro → criar evento → criar seção → `publish-all` → comprar.
7. Observar os efeitos colaterais de criar um parceiro:
   - linha na tabela `stored_event` (`SELECT type_name FROM stored_event;`);
   - `console.log` no terminal do `apps/emails`.

> **Atrito herdado (atenção):** cada teste de infra recria o schema registrando só as entities daquele teste, e nenhum registra `StoredEventSchema`. Rodar a suíte **derruba a tabela `stored_event`**, e sem ela a API responde 500 (o listener wildcard tenta gravar o evento). **Depois de rodar os testes, rode `npx mikro-orm schema:fresh --run` de novo antes de subir a API.**

### Estudo dirigido (ler lado a lado antes de codar)

- `@core/events/application/partner.service.ts` vs `@core/events/application/order.service.ts`
  → **a chave do desafio:** `PartnerService` roda dentro de `ApplicationService.run(...)` (eventos publicados + gravados em `stored_event`); `OrderService` usa o Unit of Work cru (`uow.runTransaction` / `uow.commit`) e **os eventos morrem sem publicação**.
- `@core/common/application/application.service.ts` → `finish()` publica eventos de domínio dos agregados do UoW, comita, depois publica os de integração.
- `@core/events/application/handlers/my-handler.handler.ts` + `events/events.module.ts` (`onModuleInit`) → como um handler nasce, é registrado via `DomainEventManager.register` e como o mapeamento de integração é registrado via `registerForIntegrationEvent`.
- `@core/common/domain/domain-event-manager.ts` → `register`/`publish` (domínio) e `registerForIntegrationEvent`/`publishForIntegrationEvent` (integração).

**Entregável da etapa:** ambiente rodando, roteiro manual reproduzido, entendimento confirmado de qual caminho publica eventos.

---

## 2. Design estratégico (antes de codar)

Conceitos do curso: event storming, linguagem ubíqua.

1. Criar a pasta `docs/`.
2. **`docs/event-storming.*`** (`.png`, `.jpg`, `.pdf` ou `.excalidraw`, no estilo do `Event Storming.png` da raiz). Deve conter no mínimo:
   - comandos: **Cancelar Pedido**, **Entrar na Fila de Espera**;
   - agregados: `Order`, `Event`, `WaitingList`;
   - eventos de domínio: `OrderCancelled`, `EventSpotReleased`, `CustomerJoinedWaitingList`, `SpotOfferedToWaitingCustomer`;
   - a **política**: lugar liberado → notificar o primeiro da fila;
   - o **evento de integração** cruzando para o contexto de e-mails.
3. **`docs/linguagem-ubiqua.md`** — glossário com ≥ 8 termos, 1–2 linhas cada. Sugestão de termos: Pedido, Cancelamento, Lugar (Spot), Trava de Reserva (SpotReservation), Liberação de Lugar, Lista de Espera, Entrada (WaitingListEntry), Notificação, Oferta de Lugar, Esgotamento (sold out).
   → **Os nomes do código devem corresponder aos termos do glossário.**

> Faça o event storming primeiro e **refine ao final** para refletir o que foi construído.

**Entregável:** `docs/event-storming.*` e `docs/linguagem-ubiqua.md` (versão inicial).

---

## 3. Domínio — primeiro, com testes puros (sem banco)

### 3.1 Invariante e evento enriquecido no `Order`

Arquivos: `@core/events/domain/entities/order.entity.ts`, `@core/events/domain/events/domain-events/order-cancelled.event.ts`.

- Em `Order.cancel()`: se `status === OrderStatus.CANCELLED`, lançar `new Error('Order already cancelled')`; senão setar `CANCELLED` e `addEvent(new OrderCancelled(...))`.
- Enriquecer `OrderCancelled` para carregar `event_spot_id` (o `Order` já tem `this.event_spot_id`). Novo construtor: `(aggregate_id: OrderId, status: OrderStatus, event_spot_id: EventSpotId)`.
- Ajustar `Order.toJSON()` para expor o `status` (hoje o `toJSON` não inclui `status`). Expor o nome legível do enum é bem-vindo.

### 3.2 Operação inversa da reserva na cadeia `Event → EventSection → EventSpot`

Arquivos: `event.entity.ts`, `event-section.ts`, `event-spot.ts`, e novo evento `event-spot-released.event.ts`.

- `EventSpot`: criar `markAsAvailable()` (inverso de `markAsReserved()` — seta `is_reserved = false`).
- `EventSection`: criar `markSpotAsAvailable(spot_id)` (localiza o spot, inverso de `markSpotAsReserved`).
- `Event`: criar `markSpotAsAvailable({ spot_id })`.
  → **Diferença crucial:** o handler só conhece o `spot_id`. É o próprio `Event` quem **localiza a seção dona do spot** (percorre `sections` procurando a seção que contém o spot), e é o `Event` quem descobre o `section_id` para registrar `EventSpotReleased` com `event_id`, `section_id`, `spot_id`.
- Criar o evento de domínio `EventSpotReleased` em `domain/events/domain-events/`, carregando `event_id`, `section_id`, `spot_id`.

### 3.3 Agregado novo `WaitingList`

Arquivos novos em `@core/events/domain/entities/`:

- `waiting-list.entity.ts` — raiz `WaitingList` (`AggregateRoot`), identificada por `event_id` + `section_id`, com `WaitingListId` tipado (`extends Uuid`). Coleção de filhos via `MyCollectionFactory` (como `Event` faz com as seções). IDs tipados no padrão do projeto.
- `waiting-list-entry.ts` — `WaitingListEntry` (`Entity`), com `WaitingListEntryId`, `customer_id`, `status` (`PENDING` / `NOTIFIED`) e ordem de chegada (ex.: `created_at` ou um `position` incremental).
- Enum `WaitingListEntryStatus { PENDING, NOTIFIED }`.

Métodos de domínio e invariantes na raiz:

- `join({ customer_id })`: se já existe entrada `PENDING` do mesmo cliente → `Error('Customer already in waiting list')`. Senão adiciona entrada `PENDING` (na ordem de chegada) e `addEvent(new CustomerJoinedWaitingList(...))`.
- `notifyFirstPending({ spot_id })`: promove a **primeira** entrada `PENDING` → `NOTIFIED` e registra `SpotOfferedToWaitingCustomer(customer_id, event_id, section_id, spot_id)`. Se **não há** entrada pendente → **não faz nada, sem erro**. Uma entrada `NOTIFIED` nunca é renotificada.

Eventos de domínio novos (`domain/events/domain-events/`):

- `customer-joined-waiting-list.event.ts`
- `spot-offered-to-waiting-customer.event.ts` (payload: `customer_id`, `event_id`, `section_id`, `spot_id`).

### 3.4 Testes de domínio (puros, sem banco)

Arquivos em `domain/entities/__tests__/`:

- `order.cancel()`: cancelar duas vezes lança `Order already cancelled`; `OrderCancelled` carrega `event_spot_id`.
- `Event.markSpotAsAvailable`: spot volta a `is_reserved = false` e `EventSpotReleased` aparece em `events` com `event_id`, `section_id`, `spot_id`.
- `WaitingList`: duplicidade (`Customer already in waiting list`); promoção da primeira entrada para `NOTIFIED` + registro de `SpotOfferedToWaitingCustomer`; `CustomerJoinedWaitingList` ao entrar; **notificar com fila vazia não faz nada**.

**Entregável:** domínio completo, verde em testes puros.

---

## 4. Persistência (schemas, custom types, repositórios)

Conceitos: `EntitySchema`, custom types por value object, carregamento de agregados com filhos. **Domínio continua sem decorator de framework.**

### 4.1 Custom types para os novos IDs

Arquivos novos em `@core/events/infra/db/types/` (espelhar `event-id.schema-type.ts`):

- `waiting-list-id.schema-type.ts`
- `waiting-list-entry-id.schema-type.ts`

### 4.2 Schemas

Arquivo: `@core/events/infra/db/schemas.ts` (adicionar, sem reescrever os existentes):

- `WaitingListSchema` — raiz com `event_id`/`section_id` (via custom types / mapToPk como nos outros), relação `1:m` com `WaitingListEntry` (`eager: true`, `cascade: [Cascade.ALL]`, `mappedBy`), espelhando `EventSchema → sections`.
- `WaitingListEntrySchema` — `id`, `customer_id`, `status` (enum), ordem de chegada, e FK para a raiz (`m:1`, `mapToPk`, `hidden`), espelhando `EventSectionSchema`/`EventSpotSchema`.

> Atenção ao `forceEntityConstructor: true` e ao carregamento de coleções — seguir à risca o padrão `EventSchema`/`EventSectionSchema`.

### 4.3 Contrato e repositório

Arquivos novos:

- `domain/repositories/waiting-list-repository.interface.ts` — `IWaitingListRepository extends IRepository<WaitingList>`, acrescentando a busca por **evento + seção** (ex.: `findByEventAndSection(event_id, section_id)`).
- `infra/db/repositories/waiting-list-mysql.repository.ts` — `add`, `findById`, `findAll`, `delete` e a busca por evento+seção (nos moldes de `event-mysql.repository.ts`).

### 4.4 Estender o `IEventRepository`

Arquivos: `domain/repositories/event-repository.interface.ts` e `infra/db/repositories/event-mysql.repository.ts`.

- Adicionar `findByEventSpotId(spot_id): Promise<Event>` ao contrato.
- Implementar no `EventMysqlRepository`, atravessando seções → spots (query filtrando pelo spot, ou carregando o evento que contém o spot). Usada pelo handler de liberação, que só conhece o `event_spot_id`.

### 4.5 Registrar schemas nos pontos de composição

- `src/database/database.module.ts` → adicionar `WaitingListSchema` e `WaitingListEntrySchema` à lista de entities.
- `src/mikro-orm.config.ts` → adicionar os mesmos schemas (para o `schema:fresh`).
- `src/events/events.module.ts` → adicionar aos `MikroOrmModule.forFeature([...])`.

### 4.6 Teste de repositório contra o MySQL real

Arquivo novo em `infra/db/repositories/__tests__/`:

- `waiting-list-mysql.repository.spec.ts` — nos moldes dos existentes (`orm.schema.refreshDatabase()` registrando as entities necessárias): persistir a lista com entradas, recarregar na ordem correta, e validar a busca por evento + seção.

**Entregável:** `WaitingList` e a nova busca do `EventRepository` persistindo/recarregando corretos contra o MySQL.

---

## 5. O comando de cancelamento (application service + REST)

Conceitos: modelo rico, application service, publicação de eventos. **A pegadinha central do desafio.**

1. Implementar o cancelamento via `ApplicationService.run(...)` — **não** pelo UoW cru.
   - **Opção A (recomendada para não quebrar a regressão):** criar um serviço próprio (ex.: `OrderCancelService`) ou adicionar o método no `OrderService` **com `ApplicationService` como último parâmetro do construtor** (o `order.service.spec.ts` instancia `OrderService` posicionalmente com os args atuais). Como esse spec não passa `paymentGateway` e nem o novo service, acrescentar o novo parâmetro ao final mantém a regressão.
2. Lógica do comando:
   - `const order = await this.orderRepo.findById(id)`; se não existe → `Error('Order not found')`.
   - `order.cancel()` (a invariante `Order already cancelled` mora no domínio).
   - **`await this.orderRepo.add(order)`** — mesmo vindo do banco; é o `add` que coloca o agregado no UoW para o `ApplicationService` publicar os eventos. **Sem isso, o `OrderCancelled` nunca é publicado.**
   - O comando **não** libera o lugar, **não** toca `Event` nem `WaitingList`. Só cancela e registra o evento.
3. Expor por REST no `OrdersController`:
   - `POST /events/:event_id/orders/:order_id/cancel` → retorna o pedido com `status: CANCELLED`.
4. Registrar o service no `events.module.ts` (provider + inject), passando `ApplicationService`.
5. **Validação:** chamar o endpoint e conferir em `SELECT type_name FROM stored_event;` que `OrderCancelled` aparece. É o sinal de que o fio está ligado.

**Entregável:** cancelamento exposto por REST, `OrderCancelled` publicado e gravado.

---

## 6. Reação 1 — liberação do lugar (handler)

Conceitos: eventos de domínio para desacoplar agregados, repositório com consulta além de CRUD.

Arquivo novo: `@core/events/application/handlers/order-cancelled.handler.ts`.

1. `implements IDomainEventHandler`, `static listensTo()` → `[OrderCancelled.name]`.
2. No `handle(event: OrderCancelled)`:
   - `const ev = await this.eventRepo.findByEventSpotId(event.event_spot_id)` (a nova busca).
   - `ev.markSpotAsAvailable({ spot_id: event.event_spot_id })` — o `Event` localiza a seção, libera o spot e registra `EventSpotReleased`.
   - Remover a `SpotReservation` do spot: `const r = await this.spotReservationRepo.findById(spot_id); if (r) await this.spotReservationRepo.delete(r)` (o `IRepository` já prevê `delete`).
   - **`await this.eventRepo.add(ev)`** e **`await this.domainEventManager.publish(ev)`** — handlers publicam os eventos dos agregados que manipulam (os comentários do `MyHandlerHandler` mostram esse caminho). **Sem o `publish`, a política do passo 7 nunca acorda.**
3. Registrar no `events.module.ts`: provider (useFactory com `IEventRepository`, `ISpotReservationRepository`, `DomainEventManager`) e, no `onModuleInit`, o loop de `register` para cada nome de `listensTo()`.

**Entregável:** cancelar um pedido libera o spot, remove a `SpotReservation` e publica `EventSpotReleased` (verificável na `stored_event`).

---

## 7. A fila de espera — application service + REST

Conceitos: application service, consultas simples.

Arquivo novo: `@core/events/application/waiting-list.service.ts`.

1. `join({ event_id, section_id, customer_id })` **dentro de `ApplicationService.run(...)`** (registra evento de domínio):
   - cliente existe? senão `Error('Customer not found')`.
   - evento existe? senão `Error('Event not found')`.
   - seção existe? senão `Error('Section not found')`.
   - seção esgotada? → **derivar da disponibilidade dos lugares** (nenhum spot disponível para reserva), **nunca** do contador `total_spots_reserved` (o fluxo de compra não o mantém). Se **não** esgotada → `Error('Section is not sold out')`.
   - carregar/instanciar a `WaitingList` da seção, `waitingList.join({ customer_id })` (invariante de duplicidade no domínio), `await this.waitingListRepo.add(waitingList)`.
2. `list({ event_id, section_id })` — consulta simples no estilo dos `list()` existentes, retorna as entradas na ordem de chegada com seus status.
3. Endpoints REST — novo controller `events/waiting-list/waiting-list.controller.ts`:
   - `POST /events/:event_id/sections/:section_id/waiting-list` (body `{ customer_id }`) → entrada criada (`PENDING`).
   - `GET /events/:event_id/sections/:section_id/waiting-list` → entradas na ordem de chegada.
4. Registrar service + controller no `events.module.ts`.

**Entregável:** entrar na fila (com todas as validações) e consultar a fila funcionando por REST.

---

## 8. Reação 2 — a política + evento de integração (fecha o ciclo)

Conceitos: process/policies, eventos de domínio vs integração, publicação e consumo.

### 8.1 Handler da política

Arquivo novo: `@core/events/application/handlers/event-spot-released.handler.ts`.

1. `listensTo()` → `[EventSpotReleased.name]`.
2. `handle(event)`:
   - `const wl = await this.waitingListRepo.findByEventAndSection(event.event_id, event.section_id)`.
   - se **não existe** fila → termina **sem efeito e sem erro**.
   - `wl.notifyFirstPending({ spot_id: event.spot_id })` (domínio promove a 1ª `PENDING` → `NOTIFIED`; sem pendente, não faz nada).
   - `await this.waitingListRepo.add(wl)`.
   - **`await this.domainEventManager.publish(wl)`** (domínio) **e `await this.domainEventManager.publishForIntegrationEvent(wl)`** (integração).
3. Registrar no `events.module.ts` (provider + `register` no `onModuleInit`).

### 8.2 Evento de integração

Arquivo novo: `@core/events/domain/events/integration-events/spot-offered-to-waiting-customer.int-events.ts` (espelhar `partner-created.int-events.ts`):

- `SpotOfferedToWaitingCustomerIntegrationEvent`, payload `{ customer_id, event_id, section_id, spot_id }`.

### 8.3 Mapeamento do evento de integração

No `events.module.ts → onModuleInit`, adicionar:

```ts
this.domainEventManager.registerForIntegrationEvent(
  SpotOfferedToWaitingCustomer.name,
  async (event) => {
    const integrationEvent = new SpotOfferedToWaitingCustomerIntegrationEvent(event);
    await this.integrationEventsQueue.add(integrationEvent);
  },
);
```

→ Enfileira na fila Bull `integration-events`; o `IntegrationEventsPublisher` existente leva ao RabbitMQ **sem alteração**.

### 8.4 Consumo no `apps/emails`

Arquivo: `apps/emails/src/consumer.service.ts`:

- Adicionar um novo `@RabbitSubscribe` com `routingKey: 'SpotOfferedToWaitingCustomerIntegrationEvent'` (igual ao nome do evento de integração), exchange `amq.direct`.
- `console.log` estruturado identificando **cliente** e **seção**. Sem envio real de e-mail — o log é a prova.

**Entregável:** o `EventSpotReleased` promove a 1ª entrada, publica o evento de integração, ele atravessa a fila/RabbitMQ e o `apps/emails` loga.

---

## 9. Testes finais

### 9.1 Teste de ponta a ponta em processo (o mais importante)

- Registrar os dois handlers no `DomainEventManager` **reproduzindo o que o `EventsModule.onModuleInit` faz**.
- Disparar o **cancelamento pelo caso de uso** (um único comando).
- Asserções, a partir desse único comando:
  - o spot voltou a disponível (`is_reserved = false`);
  - a `SpotReservation` do spot **não existe mais**;
  - a **primeira entrada** da fila está `NOTIFIED`.
- Testar os handlers isolados **não** satisfaz este item — é a cadeia inteira a partir de um comando.

### 9.2 Regressão

- `npm test` — toda a suíte existente deve continuar passando. Specs já marcados como `skip` nos controllers **permanecem skip**.
- Reafirmar que o construtor do `OrderService` não quebrou o `order.service.spec.ts`.
- Após rodar os testes, **`npx mikro-orm schema:fresh --run`** antes de subir a API (atrito da `stored_event`).

---

## 10. Fechamento

1. Rodar o **roteiro de validação manual** do zero, em ambiente limpo:
   - infra up + `schema:fresh` + API + `apps/emails`;
   - `api.http`: parceiro → clientes A e B → evento → seção `total_spots: 1` → `publish-all` → cliente A compra o único lugar (seção esgota);
   - cliente B entra na fila → consulta mostra `PENDING`;
   - cancelar o pedido de A;
   - verificar os **cinco efeitos**: spot disponível de novo; fila de B em `NOTIFIED`; log no `apps/emails`; `stored_event` com `CustomerJoinedWaitingList`, `OrderCancelled`, `EventSpotReleased` e `SpotOfferedToWaitingCustomer`.
2. **Atualizar o `api.http`** com as novas requisições (cancelamento, entrar na fila, consultar fila).
3. **Refinar `docs/event-storming.*` e `docs/linguagem-ubiqua.md`** para o estado final.
4. **README** com:
   - instruções para subir o projeto, preparar o banco e rodar a suíte;
   - um parágrafo justificando a fronteira do agregado `WaitingList` (por que fora do `Event`, à luz de tamanho de agregados / quando quebrar a regra);
   - um parágrafo descrevendo a cadeia completa do cancelamento (comando → eventos → handlers → evento de integração → consumidor);
   - links para os artefatos de `docs/`.
5. Consolidar tudo na branch `main` do fork e publicar o link.

---

## Restrições de arquitetura (checklist permanente)

- [ ] Domínio sem import/decorator de Nest ou MikroORM (entidades, VOs, eventos de domínio). Persistência só via `EntitySchema` + custom types.
- [ ] Application services e handlers dependem de **interfaces** de repositório, nunca de implementações concretas ou do `EntityManager`.
- [ ] O comando de cancelamento **não** libera o lugar nem promove a fila; o service da fila **não** notifica ninguém. Liberação e promoção só em **handlers**, reagindo a eventos de domínio.
- [ ] Agregados referenciam outros agregados **por ID**, nunca por objeto.
- [ ] Mecanismo base de eventos usado como está (`DomainEventManager`, `ApplicationService`, `IUnitOfWork`/`UnitOfWorkMikroOrm`, `IntegrationEventsPublisher`, `DomainEventsModule`) — estender só pelos pontos de composição (`EventsModule`, `DatabaseModule`, `apps/emails`). Limitações do mecanismo vão para o README, não para um rewrite.
- [ ] Nomenclatura, organização por contexto e padrões do projeto mantidos.
- [ ] Mensagens de erro exatamente como nas regras de negócio (`Order not found`, `Order already cancelled`, `Customer not found`, `Event not found`, `Section not found`, `Section is not sold out`, `Customer already in waiting list`).

---

## Mapa rápido de arquivos

**Criar**
- `docs/event-storming.*`, `docs/linguagem-ubiqua.md`
- `@core/events/domain/entities/waiting-list.entity.ts`, `waiting-list-entry.ts`
- `@core/events/domain/events/domain-events/event-spot-released.event.ts`
- `@core/events/domain/events/domain-events/customer-joined-waiting-list.event.ts`
- `@core/events/domain/events/domain-events/spot-offered-to-waiting-customer.event.ts`
- `@core/events/domain/events/integration-events/spot-offered-to-waiting-customer.int-events.ts`
- `@core/events/domain/repositories/waiting-list-repository.interface.ts`
- `@core/events/infra/db/repositories/waiting-list-mysql.repository.ts`
- `@core/events/infra/db/types/waiting-list-id.schema-type.ts`, `waiting-list-entry-id.schema-type.ts`
- `@core/events/application/waiting-list.service.ts`
- `@core/events/application/handlers/order-cancelled.handler.ts`
- `@core/events/application/handlers/event-spot-released.handler.ts`
- `src/events/waiting-list/waiting-list.controller.ts`
- specs: domínio (Order, Event/liberação, WaitingList), `waiting-list-mysql.repository.spec.ts`, e2e em processo

**Editar**
- `@core/events/domain/entities/order.entity.ts` (invariante + `toJSON` com status)
- `@core/events/domain/events/domain-events/order-cancelled.event.ts` (+ `event_spot_id`)
- `@core/events/domain/entities/event.entity.ts`, `event-section.ts`, `event-spot.ts` (cadeia `markSpotAsAvailable`)
- `@core/events/domain/repositories/event-repository.interface.ts` + `infra/db/repositories/event-mysql.repository.ts` (`findByEventSpotId`)
- `@core/events/application/order.service.ts` (ou service próprio) — cancelamento via `ApplicationService.run`
- `@core/events/infra/db/schemas.ts` (schemas da WaitingList)
- `src/events/orders/orders.controller.ts` (endpoint de cancelamento)
- `src/events/events.module.ts` (schemas, providers, handlers, mapeamento de integração)
- `src/database/database.module.ts` e `src/mikro-orm.config.ts` (schemas novos)
- `apps/emails/src/consumer.service.ts` (novo `@RabbitSubscribe`)
- `api.http` (novas requisições)
- `README.md`
