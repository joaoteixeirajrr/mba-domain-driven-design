import { AggregateRoot } from '../../../common/domain/aggregate-root';
import {
  AnyCollection,
  ICollection,
  MyCollectionFactory,
} from '../../../common/domain/my-collection';
import Uuid from '../../../common/domain/value-objects/uuid.vo';
import { CustomerId } from './customer.entity';
import { EventId } from './event.entity';
import { EventSectionId } from './event-section';
import { EventSpotId } from './event-spot';
import { WaitingListEntry } from './waiting-list-entry';
import { CustomerJoinedWaitingList } from '../events/domain-events/customer-joined-waiting-list.event';
import { SpotOfferedToWaitingCustomer } from '../events/domain-events/spot-offered-to-waiting-customer.event';

export class WaitingListId extends Uuid {}

export type WaitingListConstructorProps = {
  id?: WaitingListId | string;
  event_id: EventId | string;
  section_id: EventSectionId | string;
};

export class WaitingList extends AggregateRoot {
  id: WaitingListId;
  event_id: EventId;
  section_id: EventSectionId;
  private _entries: ICollection<WaitingListEntry>;

  constructor(props: WaitingListConstructorProps) {
    super();
    this.id =
      typeof props.id === 'string'
        ? new WaitingListId(props.id)
        : props.id ?? new WaitingListId();
    this.event_id =
      props.event_id instanceof EventId
        ? props.event_id
        : new EventId(props.event_id);
    this.section_id =
      props.section_id instanceof EventSectionId
        ? props.section_id
        : new EventSectionId(props.section_id);
    this._entries = MyCollectionFactory.create<WaitingListEntry>(this);
  }

  static create(command: {
    event_id: EventId | string;
    section_id: EventSectionId | string;
  }) {
    return new WaitingList({
      event_id: command.event_id,
      section_id: command.section_id,
    });
  }

  join(command: { customer_id: CustomerId }) {
    const alreadyWaiting = this.entries.find(
      (entry) =>
        entry.isPending() && entry.customer_id.equals(command.customer_id),
    );

    if (alreadyWaiting) {
      throw new Error('Customer already in waiting list');
    }

    const entry = WaitingListEntry.create({ customer_id: command.customer_id });
    this.entries.add(entry);

    this.addEvent(
      new CustomerJoinedWaitingList(
        this.id,
        entry.customer_id,
        this.event_id,
        this.section_id,
      ),
    );
  }

  notifyFirstPending(command: { spot_id: EventSpotId }) {
    const firstPending = this.firstPendingEntry();

    if (!firstPending) {
      return;
    }

    firstPending.markAsNotified();

    this.addEvent(
      new SpotOfferedToWaitingCustomer(
        this.id,
        firstPending.customer_id,
        this.event_id,
        this.section_id,
        command.spot_id,
      ),
    );
  }

  private firstPendingEntry(): WaitingListEntry | undefined {
    return [...this.entries]
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .find((entry) => entry.isPending());
  }

  get entries(): ICollection<WaitingListEntry> {
    return this._entries as ICollection<WaitingListEntry>;
  }

  set entries(entries: AnyCollection<WaitingListEntry>) {
    this._entries = MyCollectionFactory.createFrom<WaitingListEntry>(entries);
  }

  toJSON() {
    return {
      id: this.id.value,
      event_id: this.event_id.value,
      section_id: this.section_id.value,
      entries: [...this.entries]
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .map((entry) => entry.toJSON()),
    };
  }
}
