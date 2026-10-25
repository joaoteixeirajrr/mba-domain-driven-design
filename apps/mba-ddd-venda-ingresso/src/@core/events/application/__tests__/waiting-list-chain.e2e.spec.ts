import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';
import {
  CustomerSchema,
  EventSchema,
  EventSectionSchema,
  EventSpotSchema,
  OrderSchema,
  PartnerSchema,
  SpotReservationSchema,
  WaitingListSchema,
  WaitingListEntrySchema,
} from '../../infra/db/schemas';
import { UnitOfWorkMikroOrm } from '../../../common/infra/unit-of-work-mikro-orm';
import { DomainEventManager } from '../../../common/domain/domain-event-manager';
import { ApplicationService } from '../../../common/application/application.service';
import { OrderMysqlRepository } from '../../infra/db/repositories/order-mysql.repository';
import { CustomerMysqlRepository } from '../../infra/db/repositories/customer-mysql.repository';
import { EventMysqlRepository } from '../../infra/db/repositories/event-mysql.repository';
import { PartnerMysqlRepository } from '../../infra/db/repositories/partner-mysql.repository';
import { SpotReservationMysqlRepository } from '../../infra/db/repositories/spot-reservation-mysql.repository';
import { WaitingListMysqlRepository } from '../../infra/db/repositories/waiting-list-mysql.repository';
import { OrderService } from '../order.service';
import { OrderCancelledHandler } from '../handlers/order-cancelled.handler';
import { EventSpotReleasedHandler } from '../handlers/event-spot-released.handler';
import { Partner } from '../../domain/entities/partner.entity';
import { Customer } from '../../domain/entities/customer.entity';
import { Order } from '../../domain/entities/order.entity';
import { SpotReservation } from '../../domain/entities/spot-reservation.entity';
import { WaitingList } from '../../domain/entities/waiting-list.entity';
import { WaitingListEntryStatus } from '../../domain/entities/waiting-list-entry';
import { OrderCancelled } from '../../domain/events/domain-events/order-cancelled.event';
import { EventSpotReleased } from '../../domain/events/domain-events/event-spot-released.event';
import { SpotOfferedToWaitingCustomer } from '../../domain/events/domain-events/spot-offered-to-waiting-customer.event';

describe('Cadeia completa da lista de espera (e2e em processo)', () => {
  let orm: MikroORM<MySqlDriver>;

  beforeEach(async () => {
    orm = await MikroORM.init<MySqlDriver>({
      entities: [
        CustomerSchema,
        PartnerSchema,
        EventSchema,
        EventSectionSchema,
        EventSpotSchema,
        OrderSchema,
        SpotReservationSchema,
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

  it('um único comando de cancelamento libera o lugar, remove a reserva e notifica o primeiro da fila', async () => {
    // --- Semeadura ---
    const seedEm = orm.em.fork();

    const customerA = Customer.create({
      name: 'Cliente A',
      cpf: '70375887091',
    });
    const customerB = Customer.create({
      name: 'Cliente B',
      cpf: '11144477735',
    });
    await new CustomerMysqlRepository(seedEm).add(customerA);
    await new CustomerMysqlRepository(seedEm).add(customerB);

    const partner = Partner.create({ name: 'Parceiro 1' });
    await new PartnerMysqlRepository(seedEm).add(partner);
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

    // Cliente A comprou o único lugar (seção esgota).
    event.markSpotAsReserved({ section_id: section.id, spot_id: spot.id });
    await new EventMysqlRepository(seedEm).add(event);

    const reservation = SpotReservation.create({
      spot_id: spot.id,
      customer_id: customerA.id,
    });
    await new SpotReservationMysqlRepository(seedEm).add(reservation);

    const order = Order.create({
      customer_id: customerA.id,
      event_spot_id: spot.id,
      amount: 100,
    });
    await new OrderMysqlRepository(seedEm).add(order);

    // Cliente B entrou na fila de espera (PENDING).
    const waitingList = WaitingList.create({
      event_id: event.id,
      section_id: section.id,
    });
    waitingList.join({ customer_id: customerB.id });
    await new WaitingListMysqlRepository(seedEm).add(waitingList);

    await seedEm.flush();
    seedEm.clear();

    // --- Fio dos eventos (reproduz o EventsModule.onModuleInit) ---
    const domainEventManager = new DomainEventManager();

    OrderCancelledHandler.listensTo().forEach((eventName) => {
      domainEventManager.register(eventName, async (e: OrderCancelled) => {
        const em = orm.em.fork();
        const handler = new OrderCancelledHandler(
          new EventMysqlRepository(em),
          new SpotReservationMysqlRepository(em),
          domainEventManager,
        );
        await handler.handle(e);
        await em.flush();
      });
    });

    EventSpotReleasedHandler.listensTo().forEach((eventName) => {
      domainEventManager.register(eventName, async (e: EventSpotReleased) => {
        const em = orm.em.fork();
        const handler = new EventSpotReleasedHandler(
          new WaitingListMysqlRepository(em),
          domainEventManager,
        );
        await handler.handle(e);
        await em.flush();
      });
    });

    const offered: SpotOfferedToWaitingCustomer[] = [];
    domainEventManager.registerForIntegrationEvent(
      SpotOfferedToWaitingCustomer.name,
      async (e: SpotOfferedToWaitingCustomer) => {
        offered.push(e);
      },
    );

    // --- O ÚNICO comando ---
    const commandEm = orm.em.fork();
    const uow = new UnitOfWorkMikroOrm(commandEm);
    const appService = new ApplicationService(uow, domainEventManager);
    const orderService = new OrderService(
      new OrderMysqlRepository(commandEm),
      new CustomerMysqlRepository(commandEm),
      new EventMysqlRepository(commandEm),
      new SpotReservationMysqlRepository(commandEm),
      uow,
      null,
      appService,
    );

    await orderService.cancel({ order_id: order.id.value });

    // --- Asserções a partir do único comando ---
    // 1. o lugar voltou a disponível
    const reloadedEvent = await new EventMysqlRepository(
      orm.em.fork(),
    ).findByEventSpotId(spot.id.value);
    const [reloadedSpot] = reloadedEvent.sections[0].spots;
    expect(reloadedSpot.is_reserved).toBe(false);

    // 2. a reserva não existe mais
    const reloadedReservation = await new SpotReservationMysqlRepository(
      orm.em.fork(),
    ).findById(spot.id.value);
    expect(reloadedReservation).toBeNull();

    // 3. a primeira entrada da fila está NOTIFIED
    const reloadedWaitingList = await new WaitingListMysqlRepository(
      orm.em.fork(),
    ).findByEventAndSection(event.id.value, section.id.value);
    expect(reloadedWaitingList.toJSON().entries[0].status).toBe(
      WaitingListEntryStatus.NOTIFIED,
    );
    expect(reloadedWaitingList.toJSON().entries[0].customer_id).toBe(
      customerB.id.value,
    );

    // 4. o evento de integração foi disparado para o cliente da fila
    expect(offered).toHaveLength(1);
    expect(offered[0].customer_id.value).toBe(customerB.id.value);
    expect(offered[0].spot_id.value).toBe(spot.id.value);
  });
});
