# Lista de Espera de Ingressos

Políticas e eventos de domínio para desacoplar agregados

## Descrição

A plataforma de venda de ingressos construída ao longo do curso permite que parceiros (partners) criem eventos com seções e lugares, e que clientes (customers) comprem ingressos, com trava de reserva de lugar, Unit of Work transacional e um gateway de pagamento atrás de uma camada anticorrupção. Faltam duas capacidades que todo sistema de ingressos tem: desistir de uma compra e entrar na fila quando a seção esgota.

Sua tarefa é implementar a lista de espera de ponta a ponta. Um cliente cancela seu pedido; em consequência, o lugar volta a ficar disponível; e, se houver fila de espera naquela seção, o primeiro cliente da fila é notificado por e-mail de que abriu uma vaga.

O ponto sensível é arquitetural. O comando de cancelamento não pode sair manipulando o agregado de Evento para devolver o lugar, e a promoção da fila não pode acontecer de forma síncrona dentro do comando. Tudo acontece por reação a eventos de domínio, com uma política amarrando as pontas. A notificação cruza a fronteira do sistema como evento de integração, consumido pelo app de e-mails que já existe no monorepo. É exatamente o desenho que a reta final do curso ensina, agora com uma feature inteira nas suas mãos: do event storming ao consumidor RabbitMQ.

## Objetivo

Entregar, em um fork público do repositório base, a feature completa:

- Cancelamento de pedido, com invariantes no agregado e o evento de domínio `OrderCancelled` enriquecido com o que as reações precisam.
- Liberação do lugar como reação ao cancelamento: o spot volta a disponível, a trava de reserva é removida e um novo evento de domínio `EventSpotReleased` é registrado. Tudo em um handler, nunca dentro do comando.
- A lista de espera: um agregado novo (`WaitingList`), modelado, persistido e exposto por API, do zero.
- A política que fecha o ciclo: ao liberar um lugar, a primeira entrada da fila é notificada: evento de domínio `SpotOfferedToWaitingCustomer`, evento de integração correspondente e consumo no `apps/emails`.
- O design estratégico da feature: event storming e glossário de linguagem ubíqua em `docs/`.
- A suíte de testes cobrindo domínio, persistência e o fluxo de ponta a ponta, com a suíte existente continuando a passar.

Toda informação e comportamento devem ser rastreáveis ao código existente e aos conceitos do curso. Não invente requisitos fora do escopo descrito aqui.

## Repositório base

Repositório: [https://github.com/devfullcycle/mba-domain-driven-design](https://github.com/devfullcycle/mba-domain-driven-design)

Faça o fork e trabalhe a partir da branch `main` (única do projeto). A entrega final deve estar consolidada na branch `main` do seu fork.

Para subir o ambiente: `docker-compose up -d` levanta MySQL, Redis e RabbitMQ; `npm install` instala as dependências; `npm run start:dev` sobe a API principal (porta 3000) e `npx nest start emails` sobe o app de e-mails (porta 3001). O projeto não traz migrações. Para preparar o banco, use a CLI que o projeto já deixa configurada: `npx mikro-orm schema:fresh --run` recria todas as tabelas a partir do `mikro-orm.config.ts` (registre nele também os schemas novos que você criar). E um atrito herdado do projeto base, para você não cair: cada teste de infraestrutura recria o schema com `orm.schema.refreshDatabase()` registrando apenas as entities daquele teste, e nenhum deles registra o `StoredEventSchema`. Na prática, rodar a suíte derruba a tabela `stored_event`, e sem ela a API responde 500 na primeira operação, porque o listener wildcard tenta gravar o evento. Depois de rodar os testes, rode o `schema:fresh` novamente antes de subir a API. O arquivo `api.http` na raiz é o roteiro de requisições do projeto; use-o para reproduzir o fluxo completo antes de escrever qualquer código.

## O que já existe (e você vai estender)

Antes de codar, mapeie o terreno. O projeto é um monorepo Nest.js (TypeScript) com MikroORM + MySQL, fila Bull (Redis) e RabbitMQ. Pontos que você vai tocar ou usar como referência:

- Os agregados, em `apps/mba-ddd-venda-ingresso/src/@core/events/domain/entities/`: `Event` (raiz com `EventSection` → `EventSpot` como filhos, via `MyCollectionFactory`), `Order`, `SpotReservation` (a trava de reserva, identificada pelo `spot_id`), `Customer` e `Partner`.
- `Order.cancel()` já existe, mas é oco: não há invariante (dá para cancelar duas vezes) e nenhum caso de uso ou endpoint o utiliza. O evento `OrderCancelled` (em `domain/events/domain-events/order-cancelled.event.ts`) também já existe e nunca foi usado, e hoje carrega apenas `aggregate_id` e `status`.
- O `Event` sabe reservar um lugar (`markSpotAsReserved`, na cadeia Event → EventSection → EventSpot), mas a operação inversa não existe em nenhum nível da cadeia.
- Dois estilos de application service convivem no projeto. Compare-os com atenção: `OrderService` usa o Unit of Work cru (`runTransaction`/`commit`), enquanto `PartnerService` roda dentro de `ApplicationService.run(...)` (`@core/common/application/application.service.ts`), que publica os eventos de domínio dos agregados, comita e depois publica os eventos de integração. Essa diferença é uma das chaves do desafio.
- O esqueleto de handler: `IDomainEventHandler` (`@core/common/application/`), o exemplo `MyHandlerHandler` (`@core/events/application/handlers/`) e o registro de handlers em `EventsModule.onModuleInit` (`src/events/events.module.ts`). Os comentários dentro do `MyHandlerHandler` mostram o padrão pretendido para handlers que manipulam agregados.
- O `DomainEventManager` (`@core/common/domain/domain-event-manager.ts`), com `register`/`publish` para eventos de domínio e `registerForIntegrationEvent`/`publishForIntegrationEvent` para os de integração.
- O cano de integração completo, hoje com um único evento trafegando: `PartnerCreated` → `PartnerCreatedIntegrationEvent` (`domain/events/integration-events/`) → fila Bull `integration-events` (mapeamento registrado em `EventsModule.onModuleInit`) → `IntegrationEventsPublisher` (`src/domain-events/`) → RabbitMQ (exchange `amq.direct`, routing key = nome do evento) → `apps/emails/src/consumer.service.ts` (`@RabbitSubscribe`), que hoje só faz `console.log`.
- A tabela de stored events (`stored_event`, mapeada da entidade `StoredEvent`): um listener wildcard no `DomainEventsModule` grava todo evento de domínio publicado (`type_name` + `body` em JSON). Ela é o seu raio-x: se um evento não aparece lá, ele não foi publicado.
- A persistência no padrão do curso: `EntitySchema` e custom types por value object em `@core/events/infra/db/schemas.ts` e `infra/db/types/`, com o domínio livre de qualquer decorator de framework. Os testes de aplicação e de repositório rodam contra o MySQL real, criando o schema com `orm.schema.refreshDatabase()`.
- A composição: `EventsModule` (repositórios e serviços via `useFactory`) e `DatabaseModule` (lista de entities do MikroORM). Schemas novos precisam entrar nos dois, e também nos inits dos testes.

## A feature: lista de espera

### Comportamento esperado

1. Um cliente cancela um pedido pelo id. O pedido passa a `CANCELLED` e o cancelamento emite o `OrderCancelled`.
2. Reagindo a esse evento, o lugar do pedido volta a ficar disponível: o spot deixa de estar reservado, a `SpotReservation` correspondente é removida e o agregado `Event` registra o `EventSpotReleased`.
3. Um cliente pode entrar na lista de espera de uma seção esgotada (sem nenhum lugar disponível para reserva). As entradas guardam a ordem de chegada.
4. Reagindo ao `EventSpotReleased`, se houver fila naquela seção, a primeira entrada pendente é marcada como notificada e o `SpotOfferedToWaitingCustomer` é registrado; ele vira evento de integração, atravessa a fila e o RabbitMQ, e é consumido pelo `apps/emails`.
5. A fila de uma seção pode ser consultada por API.

Decisão de produto deste desafio: a política apenas notifica. O cliente avisado compra pelo fluxo normal, sem reserva nem prioridade: quem chegar primeiro leva. Não existe expiração de oferta.

### Regras de negócio e semântica de erros

Mantenha as mensagens no estilo do projeto: `Error` com string simples (ex.: `throw new Error('Order not found')`). Não é preciso padronizar códigos HTTP de erro.

- Cancelar um pedido existente (pago ou pendente): status passa a `CANCELLED` e o `OrderCancelled` é registrado, agora carregando também o `event_spot_id`.
- Cancelar um pedido que não existe: `Error` com a mensagem `Order not found`.
- Cancelar um pedido já cancelado: `Error` com a mensagem `Order already cancelled`.
- Reação ao `OrderCancelled`: o spot volta a `is_reserved = false`, a `SpotReservation` daquele spot é removida e o `EventSpotReleased` é registrado com `event_id`, `section_id` e `spot_id`.
- Entrar na lista de espera: o cliente deve existir (`Customer not found`), o evento e a seção devem existir (`Event not found` / `Section not found`, no padrão existente) e a seção deve estar esgotada (sem nenhum lugar disponível para reserva). A entrada nasce `PENDING`, na ordem de chegada, e o agregado registra o `CustomerJoinedWaitingList`.
- Entrar na fila de uma seção com lugar disponível: `Error` com a mensagem `Section is not sold out`.
- Mesmo cliente com entrada `PENDING` na mesma fila: `Error` com a mensagem `Customer already in waiting list`.
- Reação ao `EventSpotReleased` com fila na seção: a primeira entrada `PENDING` passa a `NOTIFIED` e o `SpotOfferedToWaitingCustomer` é registrado com `customer_id`, `event_id`, `section_id` e `spot_id`.
- Reação ao `EventSpotReleased` sem fila na seção (ou fila sem entradas pendentes): nada acontece, sem erro.
- Uma entrada `NOTIFIED` não é notificada novamente.

## Requisitos

Cada requisito abaixo está amarrado a conceitos trabalhados no curso. Respeitar o conceito é parte do requisito, não só fazer funcionar.

### 1. Cancelamento do pedido (comando)

Conceitos do curso: modelo rico e invariantes no agregado, application service, integração de eventos e listeners.

- Adicione a invariante em `Order.cancel()`: um pedido já cancelado não pode ser cancelado de novo.
- Enriqueça o `OrderCancelled` para carregar o `event_spot_id` além do id e do status. Eventos de domínio carregam os dados de que as reações precisam, e o `Order` já tem essa informação.
- Crie a operação de cancelamento no `OrderService` (ou em um serviço próprio, se preferir), executando dentro do `ApplicationService.run(...)`. Atenção: hoje o `OrderService` usa o Unit of Work cru, e os eventos registrados por esse caminho morrem sem publicação; só quem passa pelo `ApplicationService` tem seus eventos publicados e gravados na `stored_event`. Sem esse fio ligado, nada do restante do desafio acontece. E se optar por estender o próprio `OrderService`, cuidado com o construtor: o `order.service.spec.ts` existente o instancia posicionalmente, então adicione o `ApplicationService` como último parâmetro (ou vá de serviço próprio) para não quebrar a regressão.
- Exponha o cancelamento por REST no `OrdersController`.
- O comando não libera o lugar, não toca o agregado `Event` nem a `WaitingList`. Ele cancela o pedido e registra o evento; o resto é reação.
- Não é necessário refatorar o fluxo de compra existente (`OrderService.create`): ele continua como está.

### 2. Liberação do lugar (primeira reação)

Conceitos do curso: eventos de domínio para desacoplar agregados, repositórios com consultas além do CRUD, relação de agregado com filhos.

- Crie um handler no padrão do projeto (`IDomainEventHandler`, nos moldes do `MyHandlerHandler`, registrado em `EventsModule.onModuleInit`) reagindo ao `OrderCancelled`.
- O handler precisa localizar o `Event` dono do spot, mas o pedido só conhece o `event_spot_id`. Estenda o contrato `IEventRepository` com essa busca (ex.: `findByEventSpotId`) e implemente-a no `EventMysqlRepository`, atravessando seções e spots.
- Crie no agregado `Event` o método de domínio que devolve o lugar (ex.: `markSpotAsAvailable`), no espírito da cadeia do `markSpotAsReserved`, com uma diferença importante: o handler só conhece o `spot_id`, então é o próprio `Event` quem localiza a seção dona do spot (um espelho literal da assinatura, que exige `section_id`, não é possível aqui). A operação desce por `EventSection` até o `EventSpot`, que hoje só sabe `markAsReserved`; crie a operação inversa. É também o `Event` quem descobre o `section_id` para registrar o `EventSpotReleased` com `event_id`, `section_id` e `spot_id`.
- Remova a `SpotReservation` do spot liberado. O contrato `IRepository` já prevê `delete`, e o `SpotReservationMysqlRepository` já o implementa.
- O handler persiste o agregado alterado e publica os eventos dele através do `DomainEventManager`; os comentários do `MyHandlerHandler` mostram esse caminho. Eventos de agregados manipulados dentro de um handler não se publicam sozinhos; sem isso, a política do requisito 4 nunca acorda.

### 3. A lista de espera (agregado novo, de ponta a ponta)

Conceitos do curso: criação de entidade e agregado, relação de agregado com filhos, marcação dos artefatos do DDD, repositórios e mapeamentos, application service.

- Modele o agregado `WaitingList`: uma lista por seção (identificada por `event_id` + `section_id`), raiz com as entradas como entidades filhas (`WaitingListEntry`, com `customer_id`, status e ordem de chegada), usando `MyCollectionFactory` como o `Event` faz com as seções. Use IDs tipados no padrão do projeto.
- Invariantes no agregado: o mesmo cliente não entra duas vezes enquanto tem entrada `PENDING` (`Customer already in waiting list`); a notificação promove a primeira entrada `PENDING` para `NOTIFIED` e registra o `SpotOfferedToWaitingCustomer`; se não há entrada pendente, a operação de notificar simplesmente não faz nada.
- Eventos de domínio do agregado: `CustomerJoinedWaitingList` (ao entrar) e `SpotOfferedToWaitingCustomer` (ao notificar).
- Persistência completa no padrão do curso: contrato `IWaitingListRepository` (incluindo a busca por evento + seção), implementação `WaitingListMysqlRepository` com `EntitySchema` e custom types para os novos IDs, e registro dos schemas no `DatabaseModule`, no `EventsModule` e nos inits de teste que você criar.
- Application service (ex.: `WaitingListService`) com duas operações: entrar na fila, validando cliente, evento, seção e esgotamento (a seção está esgotada quando nenhum lugar dela está disponível para reserva; atenção: o fluxo de compra existente não mantém o contador `total_spots_reserved`, então derive o esgotamento da disponibilidade dos lugares, nunca do contador) e executando dentro do `ApplicationService.run(...)`, já que registra evento de domínio; e listar a fila da seção, uma consulta simples no estilo dos `list()` existentes.
- Endpoints REST para entrar na fila e consultá-la.
- A `WaitingList` é um agregado separado, fora do `Event`. No README, justifique essa fronteira em um parágrafo, à luz do que o curso discute sobre tamanho de agregados e quando quebrar a regra.

### 4. A política e o evento de integração (fecha o ciclo)

Conceitos do curso: process e policies, eventos de domínio vs eventos de integração, publicação e consumo de eventos de integração.

- Crie o segundo handler, reagindo ao `EventSpotReleased`: carrega a `WaitingList` da seção (se não existir fila para a seção, a reação termina sem efeito e sem erro), chama o método de domínio que promove a primeira entrada, persiste e publica os eventos do agregado, tanto os de domínio quanto os de integração (`publish` e `publishForIntegrationEvent`).
- Crie o `SpotOfferedToWaitingCustomerIntegrationEvent` no padrão do `PartnerCreatedIntegrationEvent`, com payload contendo `customer_id`, `event_id`, `section_id` e `spot_id`.
- Registre o mapeamento em `EventsModule.onModuleInit` com `registerForIntegrationEvent`, enfileirando na fila Bull `integration-events`; o `IntegrationEventsPublisher` existente leva o evento ao RabbitMQ sem nenhuma alteração.
- No `apps/emails`, adicione o consumo do novo evento no `ConsumerService` (novo `@RabbitSubscribe` com a routing key igual ao nome do evento de integração), com um `console.log` estruturado identificando cliente e seção. Não há envio real de e-mail: o log é a prova, no mesmo espírito do consumo que já existe.

### 5. Design estratégico da feature

Conceitos do curso: event storming, linguagem ubíqua.

- Produza `docs/event-storming` (`.png`, `.jpg`, `.pdf` ou `.excalidraw`) com o event storming da feature, no estilo do `Event Storming.png` que está na raiz do repositório. Ele deve conter, no mínimo: os dois comandos (cancelar pedido, entrar na fila), os agregados envolvidos, os eventos de domínio da feature, a política (lugar liberado → notificar o primeiro da fila) e o evento de integração cruzando para o contexto de e-mails.
- Produza `docs/linguagem-ubiqua.md`: um glossário com pelo menos 8 termos da feature (ex.: lista de espera, entrada, notificação, liberação de lugar, trava de reserva...), cada um com definição de uma a duas linhas. Os nomes usados no código devem corresponder aos termos do glossário.

Dica de fluxo: faça o event storming antes de codar (a política e os eventos aparecem no papel antes de aparecerem no código) e refine-o ao final, para refletir o que foi construído.

### 6. Testes

Conceitos do curso: regras de negócio em agregados, testes de repositórios contra a infraestrutura real, integração de eventos e listeners.

- Testes de domínio, puros e sem banco: invariantes de `Order.cancel()`, do `markSpotAsAvailable` (incluindo o registro do `EventSpotReleased` em `events`) e da `WaitingList` (duplicidade, promoção da primeira entrada, registro dos eventos, notificar com fila vazia não faz nada).
- Testes do `WaitingListMysqlRepository` contra o MySQL real, nos moldes dos testes existentes (`orm.schema.refreshDatabase()`): persistir a lista com entradas e recarregá-la corretamente, incluindo a busca por evento + seção.
- O teste mais importante: o fluxo de ponta a ponta em processo. Com os handlers registrados no `DomainEventManager` (reproduzindo em teste o que o `EventsModule.onModuleInit` faz), execute o cancelamento pelo caso de uso e comprove por asserção que: o spot voltou a disponível, a `SpotReservation` não existe mais e a primeira entrada da fila está `NOTIFIED`. Testar cada handler isolado não satisfaz este item: o que está em jogo é a cadeia inteira reagindo a partir de um único comando.
- A suíte existente deve continuar passando (regressão): nada do que já funcionava pode quebrar. O projeto base já traz testes marcados como skip nos specs de controllers; eles permanecem skip e não contam contra você.

## Restrições de arquitetura (não negociáveis)

Estas restrições são o que torna isto um desafio de DDD, e não de CRUD. Quebrar qualquer uma delas descaracteriza a entrega.

- O domínio não conhece framework: nenhum import ou decorator de Nest ou MikroORM em entidades, value objects ou eventos de domínio. A persistência continua via `EntitySchema` e custom types, como no restante do projeto.
- Application services e handlers dependem de contratos (interfaces de repositório), nunca de implementações concretas ou do `EntityManager`.
- O comando de cancelamento não libera o lugar nem promove a fila; o application service da fila não notifica ninguém. Liberação e promoção acontecem exclusivamente em handlers, reagindo a eventos de domínio.
- Agregados referenciam outros agregados por ID (como o projeto já faz), nunca por objeto.
- O mecanismo base de eventos é usado como está: `DomainEventManager`, `ApplicationService`, `IUnitOfWork`/`UnitOfWorkMikroOrm`, `IntegrationEventsPublisher` e `DomainEventsModule` não devem ser reescritos. Estenda registrando handlers e mapeamentos nos pontos de composição (`EventsModule`, `DatabaseModule`, `apps/emails`). Se encontrar uma limitação no mecanismo, documente-a no README em vez de contorná-la reescrevendo-o.
- Siga a nomenclatura, a organização por contexto e os padrões já estabelecidos. Você está somando uma feature ao projeto do professor, não reescrevendo o que existe.

## Fora de escopo

- Reembolso ou qualquer lógica de pagamento no cancelamento.
- Envio real de e-mail: o `console.log` no consumidor é suficiente, como já acontece hoje.
- Reserva temporária ou prioridade para o cliente notificado: a política apenas avisa, e não existe expiração de oferta.
- Concorrência e corridas (ex.: uma compra e uma promoção da fila disputando o mesmo lugar no mesmo instante).
- Garantias transacionais entre a publicação dos eventos e o commit (outbox): o mecanismo do projeto é in-process e didático; use-o como está.
- Padronização de códigos HTTP de erro: o projeto lança `Error` com mensagem simples; mantenha o padrão.
- Autenticação e autorização; frontend.
- Corrigir comportamentos pré-existentes do fluxo de compra (ex.: a reserva órfã que a compensação de pagamento pode deixar); eles não fazem parte da feature.

## Contratos sugeridos

Os contratos abaixo seguem as convenções do projeto (rotas aninhadas sob o evento, como no `OrdersController`). Ajuste detalhes conforme o padrão dos endpoints existentes; o formato exato do JSON de resposta é seu, desde que exponha os dados indicados.

```
POST /events/{event_id}/orders/{order_id}/cancel

resposta: o pedido com status CANCELLED
{ "id": "9a3b...", "status": "CANCELLED", ... }
```

```
POST /events/{event_id}/sections/{section_id}/waiting-list
{ "customer_id": "61f0..." }

resposta: a entrada criada
{ "customer_id": "61f0...", "status": "PENDING", ... }
```

```
GET /events/{event_id}/sections/{section_id}/waiting-list

resposta: as entradas da fila, na ordem de chegada, com seus status
```

Observação sobre os exemplos: o `OrderStatus` do projeto é um enum numérico; expor o nome legível na resposta (como nos exemplos) é bem-vindo, mas o formato exato é decisão sua. Note também que o `toJSON()` atual do `Order` nem inclui o status; expô-lo na resposta é trabalho seu.

Atualize também o `api.http` da raiz com as novas requisições: ele é o roteiro oficial do projeto e será usado na avaliação.

## Critérios de Aceite

Todos obrigatórios.

### Domínio

- ☐ `Order.cancel()` tem invariante: cancelar duas vezes lança `Order already cancelled`
- ☐ `OrderCancelled` carrega o `event_spot_id` além do id e do status
- ☐ Existe a operação inversa da reserva na cadeia `Event` → `EventSection` → `EventSpot`, e o método do `Event` registra o `EventSpotReleased` com `event_id`, `section_id` e `spot_id`
- ☐ Existe o agregado `WaitingList` (uma lista por evento + seção) com entradas filhas via `MyCollectionFactory`, IDs tipados e invariantes: sem cliente duplicado `PENDING`, promoção da primeira entrada para `NOTIFIED` registrando o `SpotOfferedToWaitingCustomer`, e notificar sem entrada pendente não faz nada
- ☐ Existem os eventos de domínio `EventSpotReleased`, `CustomerJoinedWaitingList` e `SpotOfferedToWaitingCustomer`
- ☐ Nenhum import ou decorator de Nest/MikroORM em entidades, value objects ou eventos de domínio

### Comando e reações

- ☐ O cancelamento é exposto por REST e executa via `ApplicationService.run(...)`
- ☐ O comando de cancelamento não toca o agregado `Event` nem a `WaitingList`
- ☐ Um handler reage ao `OrderCancelled`: localiza o `Event` pela nova busca do repositório, devolve o lugar, remove a `SpotReservation` e publica os eventos do agregado
- ☐ `IEventRepository` foi estendido com a busca do evento pelo spot, implementada no `EventMysqlRepository`
- ☐ Um segundo handler reage ao `EventSpotReleased` e promove a primeira entrada da fila pela operação de domínio da `WaitingList`
- ☐ Os dois handlers seguem o padrão `IDomainEventHandler` e estão registrados em `EventsModule.onModuleInit`

### Lista de espera

- ☐ Entrar na fila valida cliente, evento, seção e esgotamento, com as mensagens de erro definidas nas regras de negócio
- ☐ `IWaitingListRepository` + `WaitingListMysqlRepository` com `EntitySchema` e custom types, incluindo a busca por evento + seção; o agregado é persistido e recarregado com as entradas na ordem correta
- ☐ Schemas novos registrados no `DatabaseModule` e no `EventsModule`
- ☐ Endpoints REST de entrar na fila e de consulta funcionando
- ☐ `api.http` atualizado com as requisições de cancelamento e da fila

### Integração

- ☐ Existe o `SpotOfferedToWaitingCustomerIntegrationEvent` com payload `customer_id`, `event_id`, `section_id` e `spot_id`
- ☐ O mapeamento está registrado via `registerForIntegrationEvent`, enfileirando na fila `integration-events`, sem alterações no `IntegrationEventsPublisher`
- ☐ O `apps/emails` consome o novo evento com um `@RabbitSubscribe` próprio e loga cliente e seção

### Design estratégico

- ☐ `docs/event-storming.*` existe e contém, no mínimo, os dois comandos, os agregados, os eventos de domínio da feature, a política e o evento de integração
- ☐ `docs/linguagem-ubiqua.md` existe com pelo menos 8 termos definidos, e os nomes do código correspondem aos termos

### Testes

- ☐ Testes de domínio puros cobrindo as invariantes novas (Order, Event/liberação e WaitingList), incluindo o registro dos eventos em `events`
- ☐ Testes do `WaitingListMysqlRepository` contra o MySQL real, nos moldes dos existentes
- ☐ Existe o teste do fluxo de ponta a ponta: handlers registrados no `DomainEventManager`, cancelamento disparado pelo caso de uso, e asserções de que o spot está disponível, a `SpotReservation` não existe mais e a primeira entrada da fila está `NOTIFIED` (handlers testados isolados não satisfazem este item)
- ☐ A suíte existente continua passando (os testes já skipped no projeto base permanecem skipped)

### Consistência geral

- ☐ As restrições de arquitetura foram respeitadas
- ☐ As mensagens de erro seguem exatamente as definidas nas regras de negócio
- ☐ Nenhum arquivo ou classe citado na entrega é inexistente; nada fora do escopo foi adicionado

## Roteiro de validação manual

Além dos testes, a entrega será validada de ponta a ponta com este roteiro, a partir de um ambiente limpo:

**1.** `docker-compose up -d`, banco preparado com `npx mikro-orm schema:fresh --run` (todas as tabelas, inclusive a `stored_event`), API principal e `apps/emails` no ar.

**2.** Pelo `api.http`: criar parceiro → criar os clientes A e B → criar evento → criar seção com `total_spots: 1` → `publish-all` → comprar o único lugar com o cliente A (a seção esgota).

**3.** Entrar na fila da seção com o cliente B e consultar a fila: entrada `PENDING`.

**4.** Cancelar o pedido do cliente A.

**5.** Verificar as consequências: o `GET` de spots da seção mostra o lugar disponível de novo; a consulta da fila mostra a entrada do cliente B como `NOTIFIED`; o terminal do `apps/emails` exibe o log do evento de integração; e `SELECT type_name FROM stored_event;` retorna linhas contendo `CustomerJoinedWaitingList`, `OrderCancelled`, `EventSpotReleased` e `SpotOfferedToWaitingCustomer`.

Se qualquer um desses cinco efeitos não acontecer a partir do único comando de cancelamento, a cadeia está incompleta.

## Ordem de execução sugerida

**1.** Rode e entenda o projeto: suba a infraestrutura, prepare o banco (atenção ao atrito da `stored_event` descrito na seção Repositório base), percorra o `api.http` (parceiro → evento → seção → publish-all → compra) e observe os efeitos colaterais de criar um parceiro: o registro na tabela `stored_event` e o log no `apps/emails`. Esse é o cano que você vai reutilizar.

**2.** Estude os dois moldes lado a lado: `PartnerService` vs `OrderService` (por que os eventos de um fluem e os do outro morrem), e `MyHandlerHandler` + `EventsModule.onModuleInit` (como um handler nasce e é registrado).

**3.** Desenhe antes de codar: o event storming da feature e a primeira versão do glossário. A política deve aparecer no papel antes de aparecer no código.

**4.** Domínio primeiro, com testes puros: invariante do `Order`, evento enriquecido, a cadeia de liberação no `Event`, o agregado `WaitingList`.

**5.** Persistência: schemas, custom types, `WaitingListMysqlRepository` e a nova busca do `EventMysqlRepository`, com testes contra o MySQL.

**6.** O comando: cancelamento no application service via `ApplicationService.run(...)` + endpoint. Confira na tabela `stored_event` que o `OrderCancelled` está sendo gravado; é o sinal de que o fio está ligado.

**7.** As reações: o handler de liberação, depois o da política, registrados no `EventsModule`. Valide cada elo pelo banco e pela `stored_event`.

**8.** A fronteira: `WaitingListService`, endpoints e o `api.http` atualizado; o evento de integração e o `@RabbitSubscribe` no `apps/emails`.

**9.** O teste de ponta a ponta e a regressão da suíte.

**10.** Feche o ciclo: rode o roteiro de validação manual do zero, refine o event storming e o glossário para o estado final e escreva o README.

## Dicas finais

Outro elo silencioso: o `ApplicationService` publica os eventos dos agregados que estão no Unit of Work, e é o `repo.add(...)` que os coloca lá. Chame-o mesmo para um agregado que acabou de vir do banco, como o `PartnerService.update` faz; sem isso, o `order.cancel()` roda, o banco até atualiza no flush, e o `OrderCancelled` nunca é publicado.

A pegadinha central do desafio já está no código do professor: só quem executa dentro do `ApplicationService` tem seus eventos publicados. Se o seu cancelamento rodar no Unit of Work cru, tudo vai parecer funcionar (pedido cancelado, banco atualizado) e nenhuma reação vai acontecer. A tabela `stored_event` denuncia isso em segundos.

Handlers publicam os eventos dos agregados que manipulam. O `DomainEventManager` não descobre sozinho que um handler alterou um agregado; os comentários do `MyHandlerHandler` mostram o caminho. Sem isso, a corrente para no primeiro elo.

Devolver o lugar é mais do que inverter um boolean no spot: a operação nasce no agregado raiz e desce a cadeia, espelhando o `markSpotAsReserved`. E é o agregado, não o handler, quem registra o `EventSpotReleased`.

O MikroORM está com `forceEntityConstructor` ligado e o projeto carrega agregados inteiros com suas coleções de filhos. Siga à risca o padrão dos schemas e custom types existentes ao mapear a `WaitingList`; as aulas de carregamento correto de agregados existem porque essa é a parte que mais morde.

Rode o roteiro de validação manual cedo e sempre. O desafio inteiro se resume a uma frase: um único `POST` de cancelamento precisa fazer cinco coisas acontecerem em lugares diferentes do sistema, sem que nenhum comando conheça o próximo.

## Entregável

- Link do repositório público no GitHub (fork do repositório base), com a entrega consolidada na branch `main`.
- README com: instruções para subir o projeto, preparar o banco e rodar a suíte; um parágrafo justificando a fronteira do agregado `WaitingList` (por que fora do `Event`); um parágrafo descrevendo a cadeia completa do cancelamento (qual comando, quais eventos, quais handlers, qual evento de integração e quem o consome); e os links para os artefatos de `docs/`.

## Regras de entrega

- Repositório único: apenas este projeto, a partir do fork do repositório base.
- Branch principal: toda a entrega final na branch `main` do fork.
- Base obrigatória: a estrutura e os padrões do projeto base devem ser mantidos. Entregas que reescrevem o mecanismo de eventos ou ignoram as restrições de arquitetura não serão aceitas.

## Repositórios de Referência
- https://github.com/AlenKaleb/mba-domain-driven-design
- https://github.com/antoniobatista2025/mba-domain-driven-design
- https://github.com/brunocamargos/mba-domain-driven-design