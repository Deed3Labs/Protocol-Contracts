// The reference's shared data that Field and Merchants read from outside the FM2 module (design/command-center-ui):
// the forms inbox, whose shop enquiries Merchants' Pipeline shows, and its mask. data.tsx has an INBOX of its own for
// the live app's old pages, with other rows; this one is the reference's, so the redesign's figures match it.

/** Forms from useclear.org: who, their email, which form, city, where they came from, when, and its state. */
export const INBOX = [
  {who:['Marisol','Reyes'], mail:'m.reyes@gmail.com', type:'Waitlist', city:'Redlands', src:'P-003 · Rosa’s', when:'22:41', st:'New'},
  {who:['Dev','Patel'], mail:'devpatel@outlook.com', type:'Waitlist', city:'San Bernardino', src:'P-044 · Mesa Laundry', when:'22:17', st:'New'},
  {who:['Sixth St.','Tailor'], mail:'hello@sixthsttailor.com', type:'Shop enquiry', city:'Riverside', kind:'Tailor', src:'/shops', when:'21:58', st:'New', msg:'Already have your poster. How do card payments work?', known:'tailor'},
  {who:['Brockton','Coffee'], mail:'brocktoncoffee@gmail.com', type:'Shop enquiry', city:'Riverside', kind:'Café', src:'Poster · Citrus Bowl Café', when:'14:12', st:'New', msg:'Saw the poster next door. Do you work with coffee shops?'},
  {who:['Tanya','Brooks'], mail:'tbrooks@yahoo.com', type:'Waitlist', city:'Riverside', src:'Search', when:'21:30', st:'New'},
  {who:['Luis','Ortega'], mail:'l.ortega@gmail.com', type:'Land offer', city:'Mentone', src:'/contribute', when:'20:12', st:'Replied'},
  {who:['Grace','Kim'], mail:'gkim@icloud.com', type:'Waitlist', city:'Redlands', src:'P-018 · Uptown Barber', when:'19:44', st:'Invited'},
  {who:['Jordan','Hale'], mail:'jhale@proton.me', type:'Work with us', city:'Loma Linda', src:'Direct', when:'18:05', st:'New'},
  {who:['Ana','Vega'], mail:'ana.vega@gmail.com', type:'Waitlist', city:'Colton', src:'P-061 · Colton Cuts', when:'17:20', st:'Invited'},
  {who:['Mountain View','Auto'], mail:'service@mountainviewauto.com', type:'Shop enquiry', city:'Redlands', kind:'Auto repair', src:'/shops', when:'Tue', st:'New', msg:'Customers keep asking for financing on brake jobs.'},
  {who:['Pepper Ave.','Nails'], mail:'pepperavenails@gmail.com', type:'Shop enquiry', city:'Colton', kind:'Nail salon', src:'/shops', when:'Mon', st:'Replied', msg:'Interested in the $10 thing for new customers.'},
  {who:['Rancho','Liquor'], mail:'rancholiquor@yahoo.com', type:'Shop enquiry', city:'Fontana', kind:'Liquor store', src:'/shops', when:'Sun', st:'Not a fit', msg:'How much does it cost?', why:'We don’t take liquor stores'},
  {who:['Helen','Marsh'], mail:'hmarsh@sbcglobal.net', type:'Land offer', city:'Yucaipa', src:'/contribute', when:'Sun', st:'New'},
  {who:['Ray','Okoye'], mail:'rokoye@gmail.com', type:'Work with us', city:'Riverside', src:'Search', when:'Mon', st:'Replied'}
];

/** A name masked to its first letter. */
export const mask = (s: string) => s[0] + '•'.repeat(Math.max(2, Math.min(5, s.length - 1)));
