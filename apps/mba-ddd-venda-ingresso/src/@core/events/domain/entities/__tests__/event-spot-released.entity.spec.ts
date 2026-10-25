import { Event } from '../event.entity';
import { PartnerId } from '../partner.entity';
import { EventSpotId } from '../event-spot';
import { EventSpotReleased } from '../../events/domain-events/event-spot-released.event';
import { initOrm } from './helpers';

describe('Event markSpotAsAvailable Unit Tests', () => {
  initOrm();

  const makePublishedEvent = () => {
    const event = Event.create({
      name: 'Evento 1',
      description: 'Descrição',
      date: new Date(),
      partner_id: new PartnerId(),
    });
    event.addSection({
      name: 'Seção 1',
      description: 'Descrição',
      total_spots: 2,
      price: 100,
    });
    event.publishAll();
    return event;
  };

  it('deve liberar um lugar reservado e registrar EventSpotReleased', () => {
    const event = makePublishedEvent();
    const [section] = event.sections;
    const [spot] = section.spots;

    event.markSpotAsReserved({ section_id: section.id, spot_id: spot.id });
    expect(spot.is_reserved).toBe(true);

    event.clearEvents();

    event.markSpotAsAvailable({ spot_id: spot.id });

    expect(spot.is_reserved).toBe(false);

    const released = [...event.events].find(
      (e) => e instanceof EventSpotReleased,
    ) as EventSpotReleased;

    expect(released).toBeDefined();
    expect(released.aggregate_id.value).toBe(event.id.value);
    expect(released.section_id.value).toBe(section.id.value);
    expect(released.spot_id.value).toBe(spot.id.value);
  });

  it('deve lançar erro ao liberar um lugar inexistente', () => {
    const event = makePublishedEvent();
    expect(() =>
      event.markSpotAsAvailable({ spot_id: new EventSpotId() }),
    ).toThrow('Spot not found');
  });

  it('deve reportar seção esgotada quando todos os lugares estão reservados', () => {
    const event = makePublishedEvent();
    const [section] = event.sections;

    expect(event.isSectionSoldOut({ section_id: section.id })).toBe(false);

    section.spots.forEach((spot) =>
      event.markSpotAsReserved({ section_id: section.id, spot_id: spot.id }),
    );

    expect(event.isSectionSoldOut({ section_id: section.id })).toBe(true);
  });
});
