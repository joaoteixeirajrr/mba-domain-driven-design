import { IRepository } from '../../../common/domain/repository-interface';
import { EventId } from '../entities/event.entity';
import { EventSectionId } from '../entities/event-section';
import { WaitingList } from '../entities/waiting-list.entity';

export interface IWaitingListRepository extends IRepository<WaitingList> {
  findByEventAndSection(
    event_id: EventId | string,
    section_id: EventSectionId | string,
  ): Promise<WaitingList | null>;
}
