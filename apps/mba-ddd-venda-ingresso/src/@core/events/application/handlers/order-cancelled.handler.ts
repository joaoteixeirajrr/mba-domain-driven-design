import { IDomainEventHandler } from '../../../common/application/domain-event-handler.interface';
import { DomainEventManager } from '../../../common/domain/domain-event-manager';
import { OrderCancelled } from '../../domain/events/domain-events/order-cancelled.event';
import { IEventRepository } from '../../domain/repositories/event-repository.interface';
import { ISpotReservationRepository } from '../../domain/repositories/spot-reservation-repository.interface';

export class OrderCancelledHandler implements IDomainEventHandler {
  constructor(
    private eventRepo: IEventRepository,
    private spotReservationRepo: ISpotReservationRepository,
    private domainEventManager: DomainEventManager,
  ) {}

  async handle(event: OrderCancelled): Promise<void> {
    const ev = await this.eventRepo.findByEventSpotId(event.event_spot_id);

    if (!ev) {
      return;
    }

    // o Event localiza a seção dona do lugar, libera o lugar e registra
    // EventSpotReleased.
    ev.markSpotAsAvailable({ spot_id: event.event_spot_id });

    // remove a trava de reserva do lugar liberado.
    const reservation = await this.spotReservationRepo.findById(
      event.event_spot_id,
    );
    if (reservation) {
      await this.spotReservationRepo.delete(reservation);
    }

    await this.eventRepo.add(ev);

    // publica os eventos do agregado manipulado — é o EventSpotReleased que
    // acorda a política da lista de espera.
    await this.domainEventManager.publish(ev);
  }

  static listensTo(): string[] {
    return [OrderCancelled.name];
  }
}
