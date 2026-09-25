import type { z } from 'zod';
import type { BusinessDate } from './common';
import type {
  CardAvailability,
  CardDeposit,
  CardTenderStart,
  ConnectionToken,
  CreateCardTender,
  Reader,
  RecordReader,
  RegisterSmartReader,
} from './cards';
import type { CatalogItem, DiscountCode, ItemInput, OptionGroup, Reorder, StockAdjustment, StockMovement } from './catalog';
import type { BankDeposit, CountsView, DayReport, DrawerSession, SaveCount, SignOff } from './drawer';
import type {
  CreateCashTender,
  CreateClearTender,
  DiscountRequest,
  LineInput,
  Order,
  Refund,
  Receipt,
  RequestRefund,
  Tender,
} from './orders';
import type { Shop, ShopPatch, ShopSettings, ShopSettingsPatch, Staff, TaxStatus } from './shop';

type In<T extends z.ZodType> = z.input<T>;
type Range = { from: z.infer<typeof BusinessDate>; to: z.infer<typeof BusinessDate> };

/**
 * The merchant API, one method per endpoint. The app implements it twice (UI prompt, Phase 3):
 * an in-memory mock with realistic delays and failure switches, and a real client over HTTP. The
 * API implements the endpoints behind it. Screens never import either implementation.
 *
 * Every method that moves money takes an `idempotencyKey`; a retry with the same key returns the
 * first result instead of acting twice.
 *
 * **Changing this interface changes the UI's mock layer.** Flag any change in the PR.
 */
export interface MerchantApi {
  // ---- The shop ------------------------------------------------------------------------------------
  shop(): Promise<Shop>;
  /** Owners only. The address sets sales tax and the card reader location. */
  updateShop(patch: In<typeof ShopPatch>): Promise<Shop>;
  settings(): Promise<ShopSettings>;
  /** Owners only. */
  updateSettings(patch: In<typeof ShopSettingsPatch>): Promise<ShopSettings>;
  staff(): Promise<Staff[]>;
  /** Settings › Tax: where the tax comes from and the rate at the shop. */
  taxStatus(): Promise<TaxStatus>;

  // ---- Cards ---------------------------------------------------------------------------------------
  cardAvailability(): Promise<CardAvailability>;
  /** The processor's onboarding link; it returns to Settings › Payments. Owners only. */
  connectCards(): Promise<{ url: string }>;
  connectionToken(): Promise<z.infer<typeof ConnectionToken>>;
  readers(): Promise<Reader[]>;
  registerSmartReader(input: In<typeof RegisterSmartReader>): Promise<Reader>;
  /** An M2 or Tap to Pay reader the installed app connected. */
  recordReader(input: In<typeof RecordReader>): Promise<Reader>;

  // ---- The catalogue and stock ----------------------------------------------------------------------
  catalog(): Promise<CatalogItem[]>;
  createItem(input: In<typeof ItemInput>): Promise<CatalogItem>;
  updateItem(id: string, input: Partial<In<typeof ItemInput>>): Promise<CatalogItem>;
  archiveItem(id: string): Promise<CatalogItem>;
  saveOptionGroups(itemId: string, groups: Omit<OptionGroup, 'id'>[]): Promise<CatalogItem>;
  adjustStock(input: In<typeof StockAdjustment>): Promise<CatalogItem>;
  /** Every change to an item's stock, newest first. Owners and managers. */
  stockHistory(itemId: string): Promise<StockMovement[]>;
  reorders(): Promise<Reorder[]>;
  markReordered(input: { itemId: string; quantity: number; supplier: string | null; expectedOn: string | null }): Promise<Reorder>;
  receiveReorder(id: string, input: { quantity: number }): Promise<Reorder>;
  discountCodes(): Promise<DiscountCode[]>;
  createDiscountCode(input: Omit<DiscountCode, 'id' | 'uses'>): Promise<DiscountCode>;

  // ---- Orders --------------------------------------------------------------------------------------
  /** Raising an order holds its stock. The server works out tax and totals. */
  createOrder(input: { lines: In<typeof LineInput>[]; customer: string | null }): Promise<Order>;
  updateOrder(id: string, input: { lines: In<typeof LineInput>[] }): Promise<Order>;
  order(id: string): Promise<Order>;
  orders(input: { date: z.infer<typeof BusinessDate> }): Promise<Order[]>;
  /** One per order; over the applier's limit it needs a manager's or owner's PIN. */
  applyDiscount(orderId: string, input: In<typeof DiscountRequest>): Promise<Order>;
  removeDiscount(orderId: string): Promise<Order>;
  /** Same day, before capture: cards cancelled, cash back from the drawer, stock released. */
  voidOrder(orderId: string, input: { pin: string }): Promise<Order>;

  // ---- Tenders -------------------------------------------------------------------------------------
  tenders(orderId: string): Promise<Tender[]>;
  createCardTender(orderId: string, input: In<typeof CreateCardTender>): Promise<CardTenderStart>;
  /** A smart reader's payment is sent to it from the server; the M2 and Tap to Pay collect on the device. */
  presentTender(tenderId: string): Promise<Tender>;
  /** After the tap: where the payment stands, from the processor. */
  syncTender(tenderId: string): Promise<Tender>;
  /** Stop collecting on the reader, and cancel on the server. */
  cancelTender(tenderId: string): Promise<Tender>;
  /** Before Close the day captures it. */
  adjustTip(tenderId: string, input: { tipCents: number }): Promise<Tender>;
  createCashTender(orderId: string, input: In<typeof CreateCashTender>): Promise<Tender>;
  /** Raises a Clear charge for the tender; the member approves on their phone. */
  createClearTender(orderId: string, input: In<typeof CreateClearTender>): Promise<Tender>;
  sendReceipt(orderId: string, input: { by: 'text' | 'email' | 'none'; to: string | null }): Promise<void>;
  /** The receipt to print, or to show on screen. */
  receipt(orderId: string): Promise<Receipt>;

  // ---- Refunds -------------------------------------------------------------------------------------
  /** Card and cash. A Clear refund goes through the existing Clear refund endpoints. */
  requestRefund(input: In<typeof RequestRefund>): Promise<Refund>;
  decideRefund(id: string, input: { decision: 'approve' | 'decline'; pin: string | null }): Promise<Refund>;

  // ---- The drawer and Close the day ------------------------------------------------------------------
  drawer(): Promise<DrawerSession | null>;
  openDrawer(input: { startingCashCents: number }): Promise<DrawerSession>;
  /** Blind: returns only the viewer's own count until both are saved. */
  saveCount(sessionId: string, input: In<typeof SaveCount>): Promise<CountsView>;
  counts(sessionId: string): Promise<CountsView>;
  signOff(sessionId: string, input: In<typeof SignOff>): Promise<CountsView>;
  /** Captures the day's card authorisations and locks the day report. Blocked while a difference is unsigned. */
  closeDay(sessionId: string): Promise<DayReport>;
  bankDeposits(): Promise<BankDeposit[]>;
  markDeposited(depositId: string): Promise<BankDeposit>;

  // ---- Reports -------------------------------------------------------------------------------------
  dayReports(range: Range): Promise<DayReport[]>;
  cardDeposits(range: Range): Promise<CardDeposit[]>;
}
