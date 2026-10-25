import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';
import { WaitingListSchema, WaitingListEntrySchema } from '../../schemas';
import { WaitingList } from '../../../../domain/entities/waiting-list.entity';
import { WaitingListEntryStatus } from '../../../../domain/entities/waiting-list-entry';
import { CustomerId } from '../../../../domain/entities/customer.entity';
import { EventId } from '../../../../domain/entities/event.entity';
import { EventSectionId } from '../../../../domain/entities/event-section';
import { WaitingListMysqlRepository } from '../waiting-list-mysql.repository';

describe('WaitingListMysqlRepository Integration Tests', () => {
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

  it('deve persistir e recarregar a lista com entradas na ordem de chegada', async () => {
    const em = orm.em.fork();
    const repo = new WaitingListMysqlRepository(em);

    const eventId = new EventId();
    const sectionId = new EventSectionId();
    const firstCustomer = new CustomerId();
    const secondCustomer = new CustomerId();

    const waitingList = WaitingList.create({
      event_id: eventId,
      section_id: sectionId,
    });
    waitingList.join({ customer_id: firstCustomer });
    waitingList.entries.values()[0].created_at = new Date(1000);
    waitingList.join({ customer_id: secondCustomer });
    waitingList.entries.values()[1].created_at = new Date(2000);

    await repo.add(waitingList);
    await em.flush();
    em.clear();

    const found = await repo.findById(waitingList.id.value);
    expect(found).toBeDefined();
    expect(found.entries.size).toBe(2);

    const ordered = found.toJSON().entries;
    expect(ordered[0].customer_id).toBe(firstCustomer.value);
    expect(ordered[1].customer_id).toBe(secondCustomer.value);
    expect(ordered[0].status).toBe(WaitingListEntryStatus.PENDING);
  });

  it('deve buscar a lista por evento e seção', async () => {
    const em = orm.em.fork();
    const repo = new WaitingListMysqlRepository(em);

    const eventId = new EventId();
    const sectionId = new EventSectionId();

    const waitingList = WaitingList.create({
      event_id: eventId,
      section_id: sectionId,
    });
    waitingList.join({ customer_id: new CustomerId() });

    await repo.add(waitingList);
    await em.flush();
    em.clear();

    const found = await repo.findByEventAndSection(
      eventId.value,
      sectionId.value,
    );
    expect(found).toBeDefined();
    expect(found.id.value).toBe(waitingList.id.value);

    const notFound = await repo.findByEventAndSection(
      new EventId().value,
      new EventSectionId().value,
    );
    expect(notFound).toBeNull();
  });
});
