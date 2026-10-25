import { EntityManager } from '@mikro-orm/mysql';
import { Event, EventId } from '../../../domain/entities/event.entity';
import { EventSpotId } from '../../../domain/entities/event-spot';
import { IEventRepository } from '../../../domain/repositories/event-repository.interface';

export class EventMysqlRepository implements IEventRepository {
  constructor(private entityManager: EntityManager) {}

  async add(entity: Event): Promise<void> {
    this.entityManager.persist(entity);
  }

  async findById(id: string | EventId): Promise<Event> {
    return this.entityManager.findOne(Event, {
      id: typeof id === 'string' ? new EventId(id) : id,
    });
  }

  async findAll(): Promise<Event[]> {
    return this.entityManager.find(Event, {});
  }

  async delete(entity: Event): Promise<void> {
    await this.entityManager.remove(entity);
  }

  async findByEventSpotId(
    spot_id: EventSpotId | string,
  ): Promise<Event | null> {
    const spotId =
      typeof spot_id === 'string' ? new EventSpotId(spot_id) : spot_id;
    return this.entityManager.findOne(Event, {
      sections: { spots: { id: spotId } },
    } as any);
  }
}
