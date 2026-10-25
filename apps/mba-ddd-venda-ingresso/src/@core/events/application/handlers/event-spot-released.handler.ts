import { IDomainEventHandler } from '../../../common/application/domain-event-handler.interface';
import { DomainEventManager } from '../../../common/domain/domain-event-manager';
import { EventSpotReleased } from '../../domain/events/domain-events/event-spot-released.event';
import { IWaitingListRepository } from '../../domain/repositories/waiting-list-repository.interface';

export class EventSpotReleasedHandler implements IDomainEventHandler {
  constructor(
    private waitingListRepo: IWaitingListRepository,
    private domainEventManager: DomainEventManager,
  ) {}

  async handle(event: EventSpotReleased): Promise<void> {
    // EventSpotReleased.aggregate_id é o EventId.
    const waitingList = await this.waitingListRepo.findByEventAndSection(
      event.aggregate_id,
      event.section_id,
    );

    // sem fila para a seção, a política termina sem efeito e sem erro.
    if (!waitingList) {
      return;
    }

    // promove a primeira entrada PENDING para NOTIFIED (registra
    // SpotOfferedToWaitingCustomer). Sem pendentes, não faz nada.
    waitingList.notifyFirstPending({ spot_id: event.spot_id });

    await this.waitingListRepo.add(waitingList);

    // publica o evento de domínio e, em seguida, o evento de integração que
    // cruza a fronteira para o contexto de e-mails.
    await this.domainEventManager.publish(waitingList);
    await this.domainEventManager.publishForIntegrationEvent(waitingList);
  }

  static listensTo(): string[] {
    return [EventSpotReleased.name];
  }
}
