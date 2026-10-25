import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';
import {
  EventSchema,
  EventSectionSchema,
  EventSpotSchema,
  PartnerSchema,
} from '../../schemas';
import { Partner } from '../../../../domain/entities/partner.entity';
import { PartnerMysqlRepository } from '../partner-mysql.repository';
import { EventMysqlRepository } from '../event-mysql.repository';
import { EventSpotId } from '../../../../domain/entities/event-spot';

describe('EventMysqlRepository.findByEventSpotId Integration Tests', () => {
  let orm: MikroORM<MySqlDriver>;

  beforeEach(async () => {
    orm = await MikroORM.init<MySqlDriver>({
      entities: [
        PartnerSchema,
        EventSchema,
        EventSectionSchema,
        EventSpotSchema,
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

  it('deve encontrar o evento que contém o lugar informado', async () => {
    const em = orm.em.fork();
    const partnerRepo = new PartnerMysqlRepository(em);
    const eventRepo = new EventMysqlRepository(em);

    const partner = Partner.create({ name: 'Partner 1' });
    await partnerRepo.add(partner);

    const event = partner.initEvent({
      name: 'Event 1',
      date: new Date(),
      description: 'desc',
    });
    event.addSection({
      name: 'Section 1',
      description: 'desc',
      price: 100,
      total_spots: 3,
    });
    event.publishAll();

    const [section] = event.sections;
    const [spot] = section.spots;

    await eventRepo.add(event);
    await em.flush();
    em.clear();

    const found = await eventRepo.findByEventSpotId(spot.id.value);
    expect(found).toBeDefined();
    expect(found.id.value).toBe(event.id.value);

    const notFound = await eventRepo.findByEventSpotId(new EventSpotId().value);
    expect(notFound).toBeNull();
  });
});
