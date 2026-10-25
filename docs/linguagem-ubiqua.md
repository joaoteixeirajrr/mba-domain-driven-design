# Linguagem Ubíqua — Lista de Espera de Ingressos

Glossário dos termos do domínio. Os nomes usados no código (entidades, value objects,
eventos de domínio, eventos de integração e métodos) correspondem a estes termos.

| Termo | Código | Definição |
| --- | --- | --- |
| **Pedido** | `Order` | Representa a compra de um lugar por um cliente. Pode estar `PENDING`, `PAID` ou `CANCELLED`. |
| **Cancelamento** | `Order.cancel()` / `OrderCancelled` | Ação que marca o pedido como `CANCELLED`. Só pode ocorrer uma vez; cancelar de novo é inválido. |
| **Lugar** | `EventSpot` | Assento individual de uma seção do evento. Pode estar reservado (`is_reserved`) ou disponível. |
| **Reserva de Lugar** | `SpotReservation` | Trava que indica que um lugar está reservado por um cliente. Criada na compra, removida no cancelamento. |
| **Liberação de Lugar** | `Event.markSpotAsAvailable()` / `EventSpotReleased` | Devolve um lugar reservado ao estado disponível, reação ao cancelamento do pedido. |
| **Lista de Espera** | `WaitingList` | Fila de clientes interessados em uma seção esgotada. Agregado próprio, identificado por evento + seção. |
| **Entrada na Fila** | `WaitingListEntry` | Posição de um cliente na lista de espera. Tem status `PENDING` (aguardando) ou `NOTIFIED` (já ofertado). |
| **Entrar na Fila** | `WaitingList.join()` / `CustomerJoinedWaitingList` | Cliente ingressa na lista de espera de uma seção esgotada. Um mesmo cliente não entra duas vezes enquanto estiver `PENDING`. |
| **Esgotamento (Sold Out)** | derivado da disponibilidade dos lugares | Situação em que a seção não possui nenhum lugar disponível para reserva. Condição para entrar na fila. |
| **Oferta de Lugar** | `WaitingList.notifyFirstPending()` / `SpotOfferedToWaitingCustomer` | Promoção da primeira entrada `PENDING` para `NOTIFIED` quando um lugar da seção é liberado. |
| **Notificação** | `SpotOfferedToWaitingCustomerIntegrationEvent` + consumidor de e-mails | Aviso ao cliente da fila de que um lugar ficou disponível. Cruza a fronteira para o contexto de e-mails. |

## Fluxo em uma frase

O **cancelamento** de um **pedido** dispara a **liberação do lugar**; a liberação aciona a
**oferta de lugar** ao primeiro cliente `PENDING` da **lista de espera**, que recebe uma
**notificação** pelo contexto de e-mails.
