import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';
import {
  WaitingListSchema,
  WaitingListEntrySchema,
} from '../../../infra/db/schemas';
import { DomainEventManager } from '../../../../common/domain/domain-event-manager';
import { WaitingListMysqlRepository } from '../../../infra/db/repositories/waiting-list-mysql.repository';
import { EventSpotReleasedHandler } from '../event-spot-released.handler';
import { WaitingList } from '../../../domain/entities/waiting-list.entity';
import { WaitingListEntryStatus } from '../../../domain/entities/waiting-list-entry';
import { CustomerId } from '../../../domain/entities/customer.entity';
import { EventId } from '../../../domain/entities/event.entity';
import { EventSectionId } from '../../../domain/entities/event-section';
import { EventSpotId } from '../../../domain/entities/event-spot';
import { EventSpotReleased } from '../../../domain/events/domain-events/event-spot-released.event';
import { SpotOfferedToWaitingCustomer } from '../../../domain/events/domain-events/spot-offered-to-waiting-customer.event';

describe('EventSpotReleasedHandler (política) Integration Tests', () => {
  let orm: MikroORM<MySqlDriver>;

  beforeEach(async () => {
    orm = await MikroORM.init<MySqlDriver>({
      entities: [WaitingListSchema, WaitingListEntrySchema],
      dbName: 'events',
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'root',
      type: 'mysql',
      forceEntityConstructor: true,
    });
    await orm.schema.refreshDatabase();
  });

  afterEach(async () => {
    await orm.close();
  });

  it('deve notificar o primeiro da fila e publicar os eventos de domínio e integração', async () => {
    const eventId = new EventId();
    const sectionId = new EventSectionId();
    const customerId = new CustomerId();

    const em = orm.em.fork();
    const waitingList = WaitingList.create({
      event_id: eventId,
      section_id: sectionId,
    });
    waitingList.join({ customer_id: customerId });
    await new WaitingListMysqlRepository(em).add(waitingList);
    await em.flush();
    em.clear();

    const domainPublished: SpotOfferedToWaitingCustomer[] = [];
    const integrationPublished: SpotOfferedToWaitingCustomer[] = [];
    const domainEventManager = new DomainEventManager();
    domainEventManager.register(SpotOfferedToWaitingCustomer.name, async (e) =>
      domainPublished.push(e),
    );
    domainEventManager.registerForIntegrationEvent(
      SpotOfferedToWaitingCustomer.name,
      async (e) => integrationPublished.push(e),
    );

    const freshEm = orm.em.fork();
    const handler = new EventSpotReleasedHandler(
      new WaitingListMysqlRepository(freshEm),
      domainEventManager,
    );

    const spotId = new EventSpotId();
    await handler.handle(new EventSpotReleased(eventId, sectionId, spotId));
    await freshEm.flush();
    freshEm.clear();

    // a primeira entrada foi promovida para NOTIFIED
    const reloaded = await new WaitingListMysqlRepository(
      orm.em.fork(),
    ).findByEventAndSection(eventId.value, sectionId.value);
    expect(reloaded.toJSON().entries[0].status).toBe(
      WaitingListEntryStatus.NOTIFIED,
    );

    // publicou o evento de domínio e o de integração
    expect(domainPublished).toHaveLength(1);
    expect(integrationPublished).toHaveLength(1);
    expect(domainPublished[0].customer_id.value).toBe(customerId.value);
    expect(domainPublished[0].spot_id.value).toBe(spotId.value);
  });

  it('não deve fazer nada quando não há fila para a seção', async () => {
    const domainEventManager = new DomainEventManager();
    const handler = new EventSpotReleasedHandler(
      new WaitingListMysqlRepository(orm.em.fork()),
      domainEventManager,
    );

    await expect(
      handler.handle(
        new EventSpotReleased(
          new EventId(),
          new EventSectionId(),
          new EventSpotId(),
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
