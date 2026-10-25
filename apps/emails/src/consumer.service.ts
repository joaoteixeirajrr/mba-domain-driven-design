import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ConsumerService {
  @RabbitSubscribe({
    exchange: 'amq.direct',
    routingKey: 'PartnerCreatedIntegrationEvent',
    //routingKey: 'events.fullcycle.com/*',
    queue: 'emails',
  })
  handle(msg: { event_name: string; [key: string]: any }) {
    // switch(msg.event_name) {
    //     case 'PartnerCreatedIntegrationEvent':

    //     case 'PartnerUpdatedIntegrationEvent':
    // }
    console.log('ConsumerService.handle', msg);
  }

  @RabbitSubscribe({
    exchange: 'amq.direct',
    routingKey: 'SpotOfferedToWaitingCustomerIntegrationEvent',
    queue: 'emails-waiting-list',
  })
  handleSpotOfferedToWaitingCustomer(msg: {
    event_name: string;
    payload: {
      customer_id: string;
      event_id: string;
      section_id: string;
      spot_id: string;
    };
  }) {
    // Sem envio real de e-mail: o log é a prova de que a notificação chegou.
    console.log(
      `[emails] Lugar liberado! Notificando o cliente ${msg.payload.customer_id} ` +
        `sobre a seção ${msg.payload.section_id} do evento ${msg.payload.event_id} ` +
        `(lugar ${msg.payload.spot_id}).`,
    );
  }
}
