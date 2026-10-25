import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';
import {
  CustomerSchema,
  EventSchema,
  EventSectionSchema,
  EventSpotSchema,
  PartnerSchema,
  SpotReservationSchema,
} from '../../../infra/db/schemas';
import { DomainEventManager } from '../../../../common/domain/domain-event-manager';
import { EventMysqlRepository } from '../../../infra/db/repositories/event-mysql.repository';
import { PartnerMysqlRepository } from '../../../infra/db/repositories/partner-mysql.repository';
import { CustomerMysqlRepository } from '../../../infra/db/repositories/customer-mysql.repository';
import { SpotReservationMysqlRepository } from '../../../infra/db/repositories/spot-reservation-mysql.repository';
import { OrderCancelledHandler } from '../order-cancelled.handler';
import { Partner } from '../../../domain/entities/partner.entity';
import { Customer } from '../../../domain/entities/customer.entity';
import { SpotReservation } from '../../../domain/entities/spot-reservation.entity';
import { OrderStatus } from '../../../domain/entities/order.entity';
import { OrderCancelled } from '../../../domain/events/domain-events/order-cancelled.event';
import { EventSpotReleased } from '../../../domain/events/domain-events/event-spot-released.event';
import { OrderId } from '../../../domain/entities/order.entity';

describe('OrderCancelledHandler Integration Tests', () => {
  let orm: MikroORM<MySqlDriver>;

  beforeEach(async () => {
    orm = await MikroORM.init<MySqlDriver>({
      entities: [
        CustomerSchema,
        PartnerSchema,
        EventSchema,
        EventSectionSchema,
        EventSpotSchema,
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

  it('deve liberar o lugar, remover a reserva e publicar EventSpotReleased', async () => {
    const em = orm.em.fork();
    const partnerRepo = new PartnerMysqlRepository(em);
    const customerRepo = new CustomerMysqlRepository(em);
    const eventRepo = new EventMysqlRepository(em);
    const spotReservationRepo = new SpotReservationMysqlRepository(em);

    const customer = Customer.create({ name: 'Cliente 1', cpf: '70375887091' });
    await customerRepo.add(customer);

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

    event.markSpotAsReserved({ section_id: section.id, spot_id: spot.id });
    await eventRepo.add(event);

    const reservation = SpotReservation.create({
      spot_id: spot.id,
      customer_id: customer.id,
    });
    await spotReservationRepo.add(reservation);
    await em.flush();
    em.clear();

    const released: EventSpotReleased[] = [];
    const domainEventManager = new DomainEventManager();
    domainEventManager.register(EventSpotReleased.name, async (e) => {
      released.push(e);
    });

    const freshEm = orm.em.fork();
    const handler = new OrderCancelledHandler(
      new EventMysqlRepository(freshEm),
      new SpotReservationMysqlRepository(freshEm),
      domainEventManager,
    );

    const cancelledEvent = new OrderCancelled(
      new OrderId(),
      OrderStatus.CANCELLED,
      spot.id,
    );
    await handler.handle(cancelledEvent);
    await freshEm.flush();
    freshEm.clear();

    // o lugar voltou a disponível
    const reloadedEvent = await new EventMysqlRepository(
      orm.em.fork(),
    ).findByEventSpotId(spot.id.value);
    const [reloadedSection] = reloadedEvent.sections;
    const [reloadedSpot] = reloadedSection.spots;
    expect(reloadedSpot.is_reserved).toBe(false);

    // a reserva não existe mais
    const reloadedReservation = await new SpotReservationMysqlRepository(
      orm.em.fork(),
    ).findById(spot.id.value);
    expect(reloadedReservation).toBeNull();

    // EventSpotReleased foi publicado
    expect(released).toHaveLength(1);
    expect(released[0].spot_id.value).toBe(spot.id.value);
    expect(released[0].section_id.value).toBe(section.id.value);
  });
});
