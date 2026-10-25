import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';
import {
  CustomerSchema,
  EventSchema,
  EventSectionSchema,
  EventSpotSchema,
  OrderSchema,
  PartnerSchema,
  SpotReservationSchema,
} from '../../infra/db/schemas';
import { UnitOfWorkMikroOrm } from '../../../common/infra/unit-of-work-mikro-orm';
import { DomainEventManager } from '../../../common/domain/domain-event-manager';
import { ApplicationService } from '../../../common/application/application.service';
import { OrderMysqlRepository } from '../../infra/db/repositories/order-mysql.repository';
import { CustomerMysqlRepository } from '../../infra/db/repositories/customer-mysql.repository';
import { EventMysqlRepository } from '../../infra/db/repositories/event-mysql.repository';
import { SpotReservationMysqlRepository } from '../../infra/db/repositories/spot-reservation-mysql.repository';
import { OrderService } from '../order.service';
import { Order, OrderStatus } from '../../domain/entities/order.entity';
import { Customer } from '../../domain/entities/customer.entity';
import { Partner } from '../../domain/entities/partner.entity';
import { EventSpotId } from '../../domain/entities/event-spot';
import { OrderCancelled } from '../../domain/events/domain-events/order-cancelled.event';
import { PartnerMysqlRepository } from '../../infra/db/repositories/partner-mysql.repository';

describe('OrderService.cancel Integration Tests', () => {
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

  const buildService = (em, domainEventManager: DomainEventManager) => {
    const uow = new UnitOfWorkMikroOrm(em);
    const appService = new ApplicationService(uow, domainEventManager);
    return new OrderService(
      new OrderMysqlRepository(em),
      new CustomerMysqlRepository(em),
      new EventMysqlRepository(em),
      new SpotReservationMysqlRepository(em),
      uow,
      null,
      appService,
    );
  };

  it('deve cancelar um pedido e publicar OrderCancelled', async () => {
    const em = orm.em.fork();

    const customer = Customer.create({ name: 'Cliente 1', cpf: '70375887091' });
    await new CustomerMysqlRepository(em).add(customer);

    const partner = Partner.create({ name: 'Parceiro 1' });
    await new PartnerMysqlRepository(em).add(partner);
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
    await new EventMysqlRepository(em).add(event);

    const order = Order.create({
      customer_id: customer.id,
      event_spot_id: spot.id,
      amount: 100,
    });
    await new OrderMysqlRepository(em).add(order);
    await em.flush();
    em.clear();

    const published: OrderCancelled[] = [];
    const domainEventManager = new DomainEventManager();
    domainEventManager.register(OrderCancelled.name, async (event) => {
      published.push(event);
    });

    const service = buildService(em, domainEventManager);
    const cancelled = await service.cancel({ order_id: order.id.value });

    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(OrderCancelled);
    expect(published[0].event_spot_id.value).toBe(spot.id.value);
  });

  it('deve lançar erro ao cancelar pedido inexistente', async () => {
    const em = orm.em.fork();
    const service = buildService(em, new DomainEventManager());

    await expect(
      service.cancel({ order_id: new EventSpotId().value }),
    ).rejects.toThrow('Order not found');
  });
});
