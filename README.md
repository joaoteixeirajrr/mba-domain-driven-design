# MBA Full Cycle - Domain Driven Design

Este repositório contém o código-fonte e material didático do curso de Domain Driven Design do MBA Full Cycle.

O projeto é feito com Nestjs, mas o conteúdo é independente de linguagem ou framework.

## Pré-requisitos

- Node.js 18+
- Docker

## Executar o projeto

Suba as aplicações MySQL, RabbitMQ e Redis:

```bash
docker-compose up -d
```

Instale as dependências do Node.js:

```bash
npm install
```

Prepare o banco de dados (cria todas as tabelas, inclusive `stored_event` e as da
lista de espera):

```bash
npx mikro-orm schema:fresh --run
```

Suba a API principal (porta 3000):

```bash
npm run start:dev
```

Em outro terminal, suba o app de e-mails (consumidor das notificações):

```bash
npx nest start emails
```

Use o arquivo `api.http` como referência para fazer as requisições HTTP. Este arquivo funciona com a extensão [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) do VSCode.

## Rodar a suíte de testes

```bash
npm test
```

> **Atrito herdado (atenção):** cada teste de infra recria o schema registrando só
> as entidades daquele teste, e nenhum registra `StoredEventSchema`. Rodar a suíte
> **derruba a tabela `stored_event`**. Depois de rodar os testes, rode
> `npx mikro-orm schema:fresh --run` de novo antes de subir a API.

---

## Feature: Lista de espera de ingressos

Quando um pedido é cancelado, o lugar é liberado e o primeiro cliente da lista de
espera daquela seção esgotada é notificado por e-mail. Todo o fluxo é orquestrado por
**eventos de domínio**, uma **política** e um **evento de integração** que cruza a
fronteira para o contexto de e-mails.

### A cadeia completa a partir de um único comando

Um único comando de cancelamento dispara toda a reação em cadeia:

1. **Comando** `POST /events/:event_id/orders/:order_id/cancel` →
   `OrderService.cancel` roda dentro de `ApplicationService.run`, aplica
   `Order.cancel()` e publica **`OrderCancelled`** (gravado em `stored_event`).
2. **`OrderCancelledHandler`** reage ao `OrderCancelled`: localiza o evento dono do
   lugar, chama `Event.markSpotAsAvailable` (que libera o lugar e publica
   **`EventSpotReleased`**) e remove a `SpotReservation`.
3. **`EventSpotReleasedHandler`** (a **política**) reage ao `EventSpotReleased`:
   carrega a `WaitingList` da seção, promove a primeira entrada `PENDING` para
   `NOTIFIED` e publica **`SpotOfferedToWaitingCustomer`** (domínio) e o
   **`SpotOfferedToWaitingCustomerIntegrationEvent`** (integração).
4. O evento de integração é enfileirado (Bull `integration-events`), o
   `IntegrationEventsPublisher` o leva ao **RabbitMQ**, e o **`apps/emails`** consome
   e registra a notificação ao cliente.

O comando de cancelamento **não** libera o lugar nem promove a fila diretamente — a
liberação e a promoção acontecem apenas nos **handlers**, reagindo a eventos de
domínio. Isso mantém cada agregado responsável apenas pelas suas próprias invariantes.

### Endpoints da feature

- `POST /events/:event_id/orders/:order_id/cancel` — cancela o pedido.
- `POST /events/:event_id/sections/:section_id/waiting-list` (body `{ customer_id }`)
  — entra na fila de espera de uma seção esgotada.
- `GET /events/:event_id/sections/:section_id/waiting-list` — lista as entradas na
  ordem de chegada com seus status.

### Por que a `WaitingList` é um agregado separado (fora do `Event`)

A lista de espera **não** foi modelada como parte do agregado `Event`, e sim como um
agregado próprio identificado por evento + seção, referenciando `Event`, `Section` e
`Customer` **por ID**. As razões:

- **Tamanho e crescimento do agregado:** o `Event` já carrega seções e lugares de
  forma `eager`. Embutir uma fila que cresce sem limite (uma entrada por cliente
  interessado) tornaria o `Event` caro de carregar e de persistir a cada operação.
- **Fronteira de consistência:** entrar na fila e promover um cliente não precisam ser
  transacionalmente consistentes com as invariantes do `Event`. São operações que
  toleram **consistência eventual** — exatamente o que os eventos de domínio e a
  política proporcionam. Manter agregados pequenos, com uma transação por agregado, é
  a regra de ouro de DDD; quebrá-la aqui só adicionaria acoplamento.
- **Referência por ID:** a `WaitingList` referencia os outros agregados por ID
  (`event_id`, `section_id`, `customer_id`), nunca por objeto, respeitando o
  isolamento entre agregados.

### Artefatos de design

- [`docs/linguagem-ubiqua.md`](docs/linguagem-ubiqua.md) — glossário da linguagem
  ubíqua da feature.

## Professor

<a href="https://github.com/argentinaluiz">
    <img src="https://avatars.githubusercontent.com/u/4926329?v=4?s=100" width="100px;" alt=""/>
    <br />
    <sub>
        <b>Luiz Carlos</b>
    </sub>
</a>
