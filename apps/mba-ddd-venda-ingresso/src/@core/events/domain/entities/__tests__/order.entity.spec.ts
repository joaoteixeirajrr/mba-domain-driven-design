import { Order, OrderStatus } from '../order.entity';
import { CustomerId } from '../customer.entity';
import { EventSpotId } from '../event-spot';
import { OrderCancelled } from '../../events/domain-events/order-cancelled.event';
import { initOrm } from './helpers';

describe('Order Entity Unit Tests', () => {
  initOrm();

  const makeOrder = () =>
    Order.create({
      customer_id: new CustomerId(),
      event_spot_id: new EventSpotId(),
      amount: 100,
    });

  it('deve cancelar um pedido e registrar OrderCancelled com event_spot_id', () => {
    const order = makeOrder();
    order.clearEvents();

    order.cancel();

    expect(order.status).toBe(OrderStatus.CANCELLED);

    const [event] = [...order.events];
    expect(event).toBeInstanceOf(OrderCancelled);
    expect((event as OrderCancelled).event_spot_id).toBeInstanceOf(EventSpotId);
    expect((event as OrderCancelled).event_spot_id.value).toBe(
      order.event_spot_id.value,
    );
  });

  it('deve lançar erro ao cancelar um pedido já cancelado', () => {
    const order = makeOrder();
    order.cancel();

    expect(() => order.cancel()).toThrow('Order already cancelled');
  });

  it('deve expor o status no toJSON', () => {
    const order = makeOrder();
    order.cancel();

    expect(order.toJSON().status).toBe(OrderStatus.CANCELLED);
    expect(order.toJSON().status_label).toBe('CANCELLED');
  });
});
