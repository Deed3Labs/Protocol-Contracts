import type { z } from 'zod';
import type { BusinessDate } from './common';
import type {
  CardAvailability,
  CardDeposit,
  ClearFeeBill,
  CardTenderStart,
  ConnectionToken,
  CreateCardTender,
  Reader,
  RecordReader,
  RegisterSmartReader,
} from './cards';
import type { CatalogItem, DiscountCode, ItemInput, OptionGroup, Reorder, StockAdjustment, StockMovement } from './catalog';
import type { AuditEntry, BankDeposit, CloseDayResult, CountsView, DayReport, DrawerSession, Overview, SaveCount, SignOff } from './drawer';
import type {
  CreateCashTender,
  ClearChargeSent,
  CreateClearTender,
  DiscountRequest,
  LineInput,
  Order,
  OrderWithTenders,
  Refund,
  Receipt,
  RequestRefund,
  SendClearCharge,
  Tender,
} from './orders';
import type { PersonHours, SaveStaffHours, ShiftNow, StaffWeek } from './shifts';
import type { SetupProgress, Shop, ShopHours, ShopPatch, ShopSettings, ShopSettingsPatch, Staff, TaxStatus } from './shop';

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
  /** When the shop is open: the usual week and the dates that differ. */
  hours(): Promise<ShopHours>;
  /** Owners only: replaces the week and the dates. */
  saveHours(hours: In<typeof ShopHours>): Promise<ShopHours>;
  settings(): Promise<ShopSettings>;
  /** Owners only. */
  updateSettings(patch: In<typeof ShopSettingsPatch>): Promise<ShopSettings>;
  staff(): Promise<Staff[]>;
  /** Settings › Tax: where the tax comes from and the rate at the shop. */
  taxStatus(): Promise<TaxStatus>;
  /** Owners and managers: Home's Set up the till, which steps are done. */
  setup(): Promise<SetupProgress>;

  // ---- Shifts and hours --------------------------------------------------------------------------------
  /** Everyone on shift now, the earliest first. A shift starts with a PIN and ends with End shift. */
  shifts(): Promise<ShiftNow[]>;
  /** The caller's own break. */
  startBreak(): Promise<ShiftNow>;
  endBreak(): Promise<ShiftNow>;
  /** Owners and managers: end someone else's shift. The caller's own ends with signing out. */
  endShift(staffId: string): Promise<void>;
  /** The week that holds `date` (today when omitted): the shop's hours and who is booked. */
  staffWeek(date?: string): Promise<StaffWeek>;
  /** Owners and managers, or the person themselves. */
  staffHours(staffId: string): Promise<PersonHours>;
  /** Owners and managers (a manager sets counter staff's hours and their own). */
  saveStaffHours(staffId: string, input: In<typeof SaveStaffHours>): Promise<PersonHours>;

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
  /** Orders over days (93 at most), newest first, each with its tenders: Charges' card, cash and split sales. */
  orderHistory(range: Range): Promise<OrderWithTenders[]>;
  /** One per order; over the applier's limit it needs a manager's or owner's PIN. */
  applyDiscount(orderId: string, input: In<typeof DiscountRequest>): Promise<Order>;
  removeDiscount(orderId: string): Promise<Order>;
  /** Same day, before capture: cards cancelled, cash back from the drawer, stock released. */
  voidOrder(orderId: string, input: { pin: string }): Promise<Order>;
  /** An order nothing was paid on (walked away, or every payment declined): its hold released. No PIN. */
  discardOrder(orderId: string): Promise<Order>;

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
  /** A waiting Clear charge, sent to a member whose code was scanned, or as a text to a number. */
  sendClearCharge(tenderId: string, input: In<typeof SendClearCharge>): Promise<ClearChargeSent>;
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
  /** The two counts disagree: one of the two counters counts again, replacing their own count. */
  recount(sessionId: string, input: { which: 'first' | 'second' }): Promise<CountsView>;
  signOff(sessionId: string, input: In<typeof SignOff>): Promise<CountsView>;
  /**
   * Captures the day's card authorisations and locks the day report. Blocked while a difference is
   * unsigned. Returns the report and any card that couldn't be captured, with why.
   */
  closeDay(sessionId: string): Promise<CloseDayResult>;
  bankDeposits(): Promise<BankDeposit[]>;
  markDeposited(depositId: string): Promise<BankDeposit>;

  // ---- Reports -------------------------------------------------------------------------------------
  dayReports(range: Range): Promise<DayReport[]>;
  cardDeposits(range: Range): Promise<CardDeposit[]>;
  /** Owners and managers. */
  overview(range: Range): Promise<Overview>;
  /** Clear's monthly fee bills, newest first; empty unless the shop's processor can't take the fee per sale. */
  clearFeeBills(): Promise<ClearFeeBill[]>;
  /** Owners only: who did what to the money, newest first. */
  audit(range: Range): Promise<AuditEntry[]>;
}
