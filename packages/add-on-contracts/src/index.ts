// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @adminium/add-on-contracts — the shapes an add-on is written against
 * (24-marketplace-wave-4.md §5).
 *
 * Two halves, kept apart on purpose. THIS half is types, registries and Zod
 * validators with zero `node:` imports, so the storefront, the example-app SPAs
 * and Electron can all use it (01 §3). The conformance suites live behind
 * `@adminium/add-on-contracts/testing`, which may import vitest.
 */
export const PACKAGE_NAME = '@adminium/add-on-contracts';

export { fileRefSchema, type FileRef } from './common.js';

export {
  SLOT_REGISTRY,
  SLOT_IDS,
  SLOT_SURFACES,
  SLOT_FILLS,
  slotIdSchema,
  isSlotId,
  slotDefinition,
  type SlotId,
  type SlotDefinition,
  type SlotSurface,
  type SlotFill,
} from './slots.js';

export {
  CONTRACT_REGISTRY,
  CONTRACT_IDS,
  contractIdSchema,
  isContractId,
  hasContractVersion,
  type ContractId,
  type ContractDefinition,
} from './contracts.js';

export {
  ADD_ON_CATEGORIES,
  ADD_ON_ISSUE_CODES,
  CONNECT_KINDS,
  addOnBlockSchema,
  addOnCategorySchema,
  addOnConnectSchema,
  addOnEventSchema,
  addOnNetworkSchema,
  attachTargetSchema,
  connectKindSchema,
  consumesSchema,
  providesSchema,
  slotFillSchema,
  type AddOnBlock,
  type AddOnCategory,
  type AddOnIssueCode,
  type ConnectKind,
} from './add-on-block.js';

export {
  artworkRefSchema,
  jobSpecSchema,
  type ArtworkRef,
  type ArtworkSource,
  type AvailabilityVerdict,
  type JobSpec,
} from './artwork-source.js';

export {
  CarrierError,
  addressSchema,
  parcelSchema,
  rateSchema,
  shipmentSchema,
  trackEventSchema,
  type Address,
  type OrderRef,
  type Parcel,
  type Rate,
  type Shipment,
  type ShippingCarrier,
  type TrackEvent,
} from './shipping-carrier.js';

export {
  personalizationSchema,
  templateSchema,
  zoneSchema,
  type Personalization,
  type PreviewRef,
  type ProductPersonalizer,
  type ProductRef,
  type Template,
  type Verdict,
  type Zone,
  type ZoneFinish,
  type ZoneKind,
} from './product-personalizer.js';
