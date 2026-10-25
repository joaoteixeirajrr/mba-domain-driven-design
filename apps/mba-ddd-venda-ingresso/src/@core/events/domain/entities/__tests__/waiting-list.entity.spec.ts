import { WaitingList } from '../waiting-list.entity';
import { WaitingListEntryStatus } from '../waiting-list-entry';
import { CustomerId } from '../customer.entity';
import { EventId } from '../event.entity';
import { EventSectionId } from '../event-section';
import { EventSpotId } from '../event-spot';
import { CustomerJoinedWaitingList } from '../../events/domain-events/customer-joined-waiting-list.event';
import { SpotOfferedToWaitingCustomer } from '../../events/domain-events/spot-offered-to-waiting-customer.event';
import { initOrm } from './helpers';

describe('WaitingList Entity Unit Tests', () => {
  initOrm();

  const makeWaitingList = () =>
    WaitingList.create({
      event_id: new EventId(),
      section_id: new EventSectionId(),
    });

  it('deve adicionar uma entrada PENDING ao entrar na fila e registrar CustomerJoinedWaitingList', () => {
    const waitingList = makeWaitingList();
    const customerId = new CustomerId();

    waitingList.join({ customer_id: customerId });

    expect(waitingList.entries.size).toBe(1);
    const [entry] = waitingList.entries;
    expect(entry.status).toBe(WaitingListEntryStatus.PENDING);
    expect(entry.customer_id.value).toBe(customerId.value);

    const joined = [...waitingList.events].find(
      (e) => e instanceof CustomerJoinedWaitingList,
    );
    expect(joined).toBeDefined();
  });

  it('deve lançar erro ao entrar duas vezes com o mesmo cliente pendente', () => {
    const waitingList = makeWaitingList();
    const customerId = new CustomerId();

    waitingList.join({ customer_id: customerId });

    expect(() => waitingList.join({ customer_id: customerId })).toThrow(
      'Customer already in waiting list',
    );
  });

  it('deve promover a primeira entrada pendente para NOTIFIED e registrar SpotOfferedToWaitingCustomer', () => {
    const waitingList = makeWaitingList();
    const firstCustomer = new CustomerId();
    const secondCustomer = new CustomerId();

    waitingList.join({ customer_id: firstCustomer });
    // garante ordem de chegada distinta
    waitingList.entries.values()[0].created_at = new Date(1000);
    waitingList.join({ customer_id: secondCustomer });
    waitingList.entries.values()[1].created_at = new Date(2000);
    waitingList.clearEvents();

    const spotId = new EventSpotId();
    waitingList.notifyFirstPending({ spot_id: spotId });

    const entries = waitingList.entries.values();
    const first = entries.find((e) => e.customer_id.equals(firstCustomer));
    const second = entries.find((e) => e.customer_id.equals(secondCustomer));

    expect(first.status).toBe(WaitingListEntryStatus.NOTIFIED);
    expect(second.status).toBe(WaitingListEntryStatus.PENDING);

    const offered = [...waitingList.events].find(
      (e) => e instanceof SpotOfferedToWaitingCustomer,
    ) as SpotOfferedToWaitingCustomer;
    expect(offered).toBeDefined();
    expect(offered.customer_id.value).toBe(firstCustomer.value);
    expect(offered.spot_id.value).toBe(spotId.value);
  });

  it('não deve fazer nada ao notificar com a fila vazia', () => {
    const waitingList = makeWaitingList();
    waitingList.clearEvents();

    expect(() =>
      waitingList.notifyFirstPending({ spot_id: new EventSpotId() }),
    ).not.toThrow();

    const offered = [...waitingList.events].find(
      (e) => e instanceof SpotOfferedToWaitingCustomer,
    );
    expect(offered).toBeUndefined();
  });

  it('não deve renotificar uma entrada já NOTIFIED', () => {
    const waitingList = makeWaitingList();
    waitingList.join({ customer_id: new CustomerId() });

    waitingList.notifyFirstPending({ spot_id: new EventSpotId() });
    waitingList.clearEvents();
    // segunda notificação sem pendentes não faz nada
    waitingList.notifyFirstPending({ spot_id: new EventSpotId() });

    const offered = [...waitingList.events].find(
      (e) => e instanceof SpotOfferedToWaitingCustomer,
    );
    expect(offered).toBeUndefined();
  });
});
