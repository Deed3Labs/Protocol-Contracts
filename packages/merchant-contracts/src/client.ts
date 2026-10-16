import type { z } from 'zod';
import type { BusinessDate } from './common';
import type {
  CardAvailability,
  ExplainFlag,
  Reconciliation,
  ReconciliationFlag,
  CardDeposit,
  ClearFeeBill,
  CardTenderStart,
  ConnectionToken,
  CreateCardTender,
  Reader,
  RecordReader,
  RegisterSmartReader,
} from './cards';
import type { CatalogImport, CatalogItem, CategoryOrder, DiscountCode, ImportResult, ItemInput, OptionGroup, Reorder, StockAdjustment, StockMovement } from './catalog';
import type { MerchantPayApi } from './pay';
import type { MerchantRewardsApi } from './rewards';
import type { AuditEntry, BankDeposit, SendStatement, CloseDayFigures,
  CloseDayResult, CountsView, DayReport, DrawerSession, Overview, SaveCount, SignOff } from './drawer';
import type {
  CreateCashTender,
  CreateOrder,
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
import type {
  AddDevice,
  ApproveNoSale,
  ClaimedPoint,
  ClaimPoint,
  Device,
  DrawerDay,
  DrawerEventBatch,
  DrawerEventsSaved,
  DrawerKey,
  NoSaleApproval,
  PointDevice,
  ShowOnPoint,
  UpdateDevice,
} from './devices';
import type { AddParty, Alert, CreateAlert, Floor, MoveTable, PartySeated, PickupOrder, SeatParty, SeatTable, TableInput, TableMoved, TableRequest, TableView, UpdateParty, Waitlist, WaitlistParty } from './floor';
import type { PersonHours, SaveStaffHours, ShiftNow, StaffWeek } from './shifts';
import type { AddBank, BankAccount, KybStatus, ReceiveDetails, SetupProgress, Shop, ShopHours, StartKyb, ShopPatch, ShopSettings, ShopSettingsPatch, Staff, TaxStatus } from './shop';

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
/** Pay with Clear's links join now; Developers' calls join in Phase 4, when the mock has them. */
type MerchantPayLinksApi = Pick<MerchantPayApi, 'paymentLinks' | 'createPaymentLink' | 'deactivatePaymentLink'>;

export interface MerchantApi extends MerchantRewardsApi, MerchantPayLinksApi {
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
  /** Owners and managers: where the shop's business verification with Bridge stands. */
  kyb(): Promise<KybStatus>;
  /** Owners: the hosted verification link (Bridge's terms, then the business's details). */
  startKyb(input: In<typeof StartKyb>): Promise<{ url: string }>;
  /** Owners: a Plaid Link token, to link a bank. */
  bankLinkToken(): Promise<{ linkToken: string }>;
  /** Owners: the account chosen in Plaid Link, registered to withdraw to. */
  addBank(input: In<typeof AddBank>): Promise<BankAccount>;
  /** Owners and managers: where withdrawals can go. */
  bankAccounts(): Promise<BankAccount[]>;
  /** Owners. */
  removeBank(id: string): Promise<void>;
  /** Owners and managers: the shop's account and routing numbers for being paid by ACH or wire. */
  receiveDetails(): Promise<ReceiveDetails>;
  /** Owners: open the account (once the business is verified). */
  openReceive(): Promise<ReceiveDetails>;
  /** Owners and managers: email the details to the address the business was verified under. */
  emailReceive(): Promise<{ to: string }>;

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
  /** As of the week holding `weekOf` (this week when not given). */
  staffHours(staffId: string, weekOf?: string): Promise<PersonHours>;
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
  /** Owners and managers: many items at once, from a spreadsheet; matches add to stock. */
  importCatalog(input: In<typeof CatalogImport>): Promise<ImportResult>;
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
  /** The order categories show in on phones and Points. Anyone on shift reads; managers save. */
  categoryOrder(): Promise<CategoryOrder>;
  saveCategoryOrder(input: In<typeof CategoryOrder>): Promise<CategoryOrder>;

  // ---- Orders --------------------------------------------------------------------------------------
  /**
   * Raising an order holds its stock. The server works out tax and totals, except for a cash sale
   * queued offline (`CreateOrder.offline`). A key makes a retry the same order.
   */
  createOrder(input: In<typeof CreateOrder>): Promise<Order>;
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
  /** The day being closed, for whoever may close it (Settings › Closing): one day of the Overview. */
  closeDayFigures(sessionId: string): Promise<CloseDayFigures>;
  bankDeposits(): Promise<BankDeposit[]>;
  markDeposited(depositId: string): Promise<BankDeposit>;

  // ---- Counter hardware (terminal reference, 1–7) --------------------------------------------------------
  /** Points, drawers and printers (`GET /hardware`). Anyone on shift: Show on and the drawer need them. */
  hardware(): Promise<Device[]>;
  /** Owners: a drawer or printer the tablet found (`POST /hardware`). */
  addDevice(input: In<typeof AddDevice>): Promise<Device>;
  /** Owners (`PATCH /hardware/:id`). */
  updateDevice(id: string, input: In<typeof UpdateDevice>): Promise<Device>;
  /** Owners: unpair (`DELETE /hardware/:id`). A Point's key stops working and it goes back to setup. */
  removeDevice(id: string): Promise<void>;
  /** Owners: bind an unclaimed Point to the shop (`POST /points/claim`). */
  claimPoint(input: In<typeof ClaimPoint>): Promise<ClaimedPoint>;
  /** Anyone on shift: put an order, an alert or the test screen on a Point, or clear it (`POST /points/:id/show`). */
  showOnPoint(pointId: string, input: In<typeof ShowOnPoint>): Promise<PointDevice>;
  /** An enrolled tablet, online: the drawer's signing key, kept for offline opens (`GET /drawers/:id/key`). */
  drawerKey(drawerId: string): Promise<DrawerKey>;
  /** The drawer's log, in order, once each however often it's sent (`POST /drawer/events`). */
  saveDrawerEvents(input: In<typeof DrawerEventBatch>): Promise<DrawerEventsSaved>;
  /** A No sale's reason and PIN, checked before the drawer opens (`POST /drawer/no-sale`). */
  approveNoSale(input: In<typeof ApproveNoSale>): Promise<NoSaleApproval>;
  /** Close the day › the drawer: every open today (`GET /drawer/:id/opens`). */
  drawerDay(sessionId: string): Promise<DrawerDay>;

  // ---- Tables, the wait list, alerts (terminal reference, 8–9) -------------------------------------------
  /** The Floor page: tables with their tabs and Points, and the wait list (`GET /tables`). */
  floor(): Promise<Floor>;
  /** Owners and managers: Edit tables, replacing the set (`PUT /tables`). A table with an open tab stays. */
  saveTables(input: { tables: (In<typeof TableInput> & { id?: string })[] }): Promise<Floor>;
  /**
   * Seat a table (`POST /tables/:id/seat`): a held party who sat down (the hold ends), or a walk-in at a
   * free table, with how many and an optional name.
   */
  seatTable(tableId: string, input?: In<typeof SeatTable>): Promise<TableView>;
  /** Move a seated table to a free one: its tab, bill, party and name on the Point (`POST /tables/:id/move`). */
  moveTable(tableId: string, input: In<typeof MoveTable>): Promise<TableMoved>;
  /** A paid table is free again (`POST /tables/:id/clear`), by hand or after the shop's delay. */
  clearTable(tableId: string): Promise<TableView>;
  /**
   * Undo a seat (`POST /tables/:id/unseat`): a seated or held table with nothing on its tab is free again;
   * a party from the wait list goes back on it in their old place.
   */
  unseatTable(tableId: string): Promise<TableView>;
  waitlist(): Promise<Waitlist>;
  addParty(input: In<typeof AddParty>): Promise<WaitlistParty>;
  updateParty(id: string, input: In<typeof UpdateParty>): Promise<WaitlistParty>;
  /** The Seat sheet: party seated, table and its Point held, Table ready at the door, a text if asked (`POST /waitlist/:id/seat`). */
  seatParty(partyId: string, input: In<typeof SeatParty>): Promise<PartySeated>;
  /** Text: almost ready (`POST /waitlist/:id/notify`). Only with their number and consent. */
  notifyParty(partyId: string): Promise<WaitlistParty>;
  /** No show: off the list, counted as one (`POST /waitlist/:id/no-show`). */
  noShowParty(partyId: string): Promise<WaitlistParty>;
  /** Calls and bills: open ones, and the last hour's (`GET /table-requests`). */
  tableRequests(): Promise<TableRequest[]>;
  /** On my way: the request closes, the ring goes off, the Point goes back (`POST /table-requests/:id/answer`). */
  answerTableRequest(id: string): Promise<TableRequest>;
  /** Table ready or Order ready: on a Point, and texted if there's a number (`POST /alerts`). */
  createAlert(input: In<typeof CreateAlert>): Promise<Alert>;
  clearAlert(id: string): Promise<Alert>;
  /** Home's Order ready cell (`GET /pickups`). */
  pickups(): Promise<PickupOrder[]>;
  /** Picked up: clears its alert (`POST /orders/:id/picked-up`). */
  markPickedUp(orderId: string): Promise<PickupOrder>;

  // ---- Reports -------------------------------------------------------------------------------------
  dayReports(range: Range): Promise<DayReport[]>;
  cardDeposits(range: Range): Promise<CardDeposit[]>;
  /** Owners and managers. */
  overview(range: Range): Promise<Overview>;
  /** Clear's monthly fee bills, newest first; empty unless the shop's processor can't take the fee per sale. */
  clearFeeBills(): Promise<ClearFeeBill[]>;
  /** Owners only: who did what to the money, newest first. */
  audit(range: Range): Promise<AuditEntry[]>;
  /** Owners and managers: where the books and the processor disagree, open and recently explained. */
  reconciliation(): Promise<Reconciliation>;
  /** Owners and managers: close a flag with what happened. */
  explainFlag(id: string, input: In<typeof ExplainFlag>): Promise<ReconciliationFlag>;
  /** Owners and managers: a month's statement, emailed (to an accountant). */
  sendStatement(input: In<typeof SendStatement>): Promise<{ sentTo: string }>;
}
