import type { BleLink } from '../../ble/central';
import { USER_DESCRIPTION } from '../../ble/central';
import { text } from '../../ble/bytes';
import type { EndpointTransport } from './client';

/**
 * ESP32 provisioning over Bluetooth: each endpoint is a characteristic of the Point's provisioning
 * service, named by its user description ("prov-session", "prov-config"…). A request is a write; its
 * answer is the read that follows.
 */
export async function bleEndpoints(link: BleLink, service: string): Promise<EndpointTransport> {
  const svc = (await link.services()).find((s) => s.uuid.toLowerCase() === service.toLowerCase());
  if (!svc) throw new Error('That isn’t a Clear Point');
  const byName = new Map<string, string>();
  for (const c of svc.characteristics) {
    if (!c.descriptors.some((d) => d.toLowerCase() === USER_DESCRIPTION)) continue;
    byName.set(text(await link.readDescriptor(service, c.uuid, USER_DESCRIPTION)).replace(/\0+$/, ''), c.uuid);
  }
  return {
    call: async (endpoint, request) => {
      const uuid = byName.get(endpoint);
      if (!uuid) throw new Error(`The Point has no ${endpoint}`);
      await link.write(service, uuid, request);
      return link.read(service, uuid);
    },
  };
}
