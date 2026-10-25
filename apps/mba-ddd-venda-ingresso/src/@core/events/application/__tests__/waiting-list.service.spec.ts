import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';
import {
  CustomerSchema,
  EventSchema,
  EventSectionSchema,
  EventSpotSchema,
  PartnerSchema,
  WaitingListSchema,
  WaitingListEntrySchema,
} from '../../infra/db/schemas';
import { UnitOfWorkMikroOrm } from '../../../common/infra/unit-of-work-mikro-orm';
import { DomainEventManager } from '../../../common/domain/domain-event-manager';
import { ApplicationService } from '../../../common/application/application.service';
import { CustomerMysqlRepository } from '../../infra/db/repositories/customer-mysql.repository';
import { EventMysqlRepository } from '../../infra/db/repositories/event-mysql.repository';
import { PartnerMysqlRepository } from '../../infra/db/repositories/partner-mysql.repository';
import { WaitingListMysqlRepository } from '../../infra/db/repositories/waiting-list-mysql.repository';
import { WaitingListService } from '../waiting-list.service';
import { Partner } from '../../domain/entities/partner.entity';
import { Customer } from '../../domain/entities/customer.entity';
import { EventId } from '../../domain/entities/event.entity';
import { EventSectionId } from '../../domain/entities/event-section';
import { CustomerId } from '../../domain/entities/customer.entity';

describe('WaitingListService Integration Tests', () => {
  let orm: MikroORM<MySqlDriver>;

  beforeEach(async () => {
    orm = await MikroORM.init<MySqlDriver>({
      entities: [
        CustomerSchema,
        PartnerSchema,
        EventSchema,
        EventSectionSchema,
        EventSpotSchema,
        WaitingListSchema,
        WaitingListEntrySchema,
      ],
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

  const buildService = (em) => {
    const uow = new UnitOfWorkMikroOrm(em);
    const appService = new ApplicationService(uow, new DomainEventManager());
    return new WaitingListService(
      new CustomerMysqlRepository(em),
      new EventMysqlRepository(em),
      new WaitingListMysqlRepository(em),
      appService,
    );
  };

  const seedSoldOutEvent = async (em, soldOut = true) => {
    const partnerRepo = new PartnerMysqlRepository(em);
    const eventRepo = new EventMysqlRepository(em);

    const partner = Partner.create({ name: 'Parceiro 1' });
    await partnerRepo.add(partner);
    const event = partner.initEvent({
      name: 'Evento 1',
      description: 'desc',
      date: new Date(),
    });
    event.addSection({
      name: 'Seção 1',
      description: 'desc',
      price: 100,
      total_spots: 1,
    });
    event.publishAll();
    const [section] = event.sections;
    const [spot] = section.spots;
    if (soldOut) {
      event.markSpotAsReserved({ section_id: section.id, spot_id: spot.id });
    }
    await eventRepo.add(event);
    return { event, section };
  };

  const seedCustomer = async (em, cpf = '70375887091') => {
    const customer = Customer.create({ name: 'Cliente', cpf });
    await new CustomerMysqlRepository(em).add(customer);
    return customer;
  };

  it('deve entrar na fila de uma seção esgotada', async () => {
    let em = orm.em.fork();
    const { event, section } = await seedSoldOutEvent(em);
    const customer = await seedCustomer(em);
    await em.flush();
    em.clear();

    em = orm.em.fork();
    const service = buildService(em);
    const waitingList = await service.join({
      event_id: event.id.value,
      section_id: section.id.value,
      customer_id: customer.id.value,
    });

    expect(waitingList.entries.size).toBe(1);

    const listed = await buildService(orm.em.fork()).list({
      event_id: event.id.value,
      section_id: section.id.value,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0].customer_id).toBe(customer.id.value);
    expect(listed[0].status).toBe('PENDING');
  });

  it('deve lançar erro quando o cliente não existe', async () => {
    const em = orm.em.fork();
    const { event, section } = await seedSoldOutEvent(em);
    await em.flush();
    em.clear();

    const service = buildService(orm.em.fork());
    await expect(
      service.join({
        event_id: event.id.value,
        section_id: section.id.value,
        customer_id: new CustomerId().value,
      }),
    ).rejects.toThrow('Customer not found');
  });

  it('deve lançar erro quando o evento não existe', async () => {
    const em = orm.em.fork();
    const customer = await seedCustomer(em);
    await em.flush();
    em.clear();

    const service = buildService(orm.em.fork());
    await expect(
      service.join({
        event_id: new EventId().value,
        section_id: new EventSectionId().value,
        customer_id: customer.id.value,
      }),
    ).rejects.toThrow('Event not found');
  });

  it('deve lançar erro quando a seção não existe', async () => {
    const em = orm.em.fork();
    const { event } = await seedSoldOutEvent(em);
    const customer = await seedCustomer(em);
    await em.flush();
    em.clear();

    const service = buildService(orm.em.fork());
    await expect(
      service.join({
        event_id: event.id.value,
        section_id: new EventSectionId().value,
        customer_id: customer.id.value,
      }),
    ).rejects.toThrow('Section not found');
  });

  it('deve lançar erro quando a seção não está esgotada', async () => {
    const em = orm.em.fork();
    const { event, section } = await seedSoldOutEvent(em, false);
    const customer = await seedCustomer(em);
    await em.flush();
    em.clear();

    const service = buildService(orm.em.fork());
    await expect(
      service.join({
        event_id: event.id.value,
        section_id: section.id.value,
        customer_id: customer.id.value,
      }),
    ).rejects.toThrow('Section is not sold out');
  });

  it('deve lançar erro quando o cliente já está na fila', async () => {
    const em = orm.em.fork();
    const { event, section } = await seedSoldOutEvent(em);
    const customer = await seedCustomer(em);
    await em.flush();
    em.clear();

    await buildService(orm.em.fork()).join({
      event_id: event.id.value,
      section_id: section.id.value,
      customer_id: customer.id.value,
    });

    await expect(
      buildService(orm.em.fork()).join({
        event_id: event.id.value,
        section_id: section.id.value,
        customer_id: customer.id.value,
      }),
    ).rejects.toThrow('Customer already in waiting list');
  });
});
