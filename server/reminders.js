import {randomInt,timingSafeEqual} from 'node:crypto';
import {payableAmount} from '../shared/payments.js';
import {money} from '../shared/calculations.js';
import {reminderQuotes} from './reminder-quotes.js';

const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'});
const hourFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Karachi',hour:'2-digit',hourCycle:'h23'});
export const reminderDay=now=>dateFormat.format(now);
export const isReminderHour=now=>hourFormat.format(now)==='00';
export function validCronSecret(header,secret) {
  if(typeof secret!=='string'||secret.length<32||typeof header!=='string')return false;
  const expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(header);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
export function reminderQuote(index,name,amount) {
  const quote=reminderQuotes[index]??reminderQuotes[0];
  // Callback replacement treats names containing $ or braces as literal text.
  return quote.replace(/\{(name|amount)\}/g,(_,key)=>key==='name'?name:money(amount));
}
export async function reminderBalance(db,userId) {
  const debts=await db.many('debts',{debtor_id:userId,status:{$ne:'confirmed'}});
  const groups=new Map();let total=0;
  for(const debt of debts) {
    const amount=payableAmount(debt);
    if(amount<=0)continue;
    total+=amount;groups.set(debt.creditor_id,(groups.get(debt.creditor_id)||0)+amount);
  }
  return {total,groups};
}

// Only one outbox record per recipient and Pakistan calendar day. SMTP retries
// keep that same record; each send attempt rebuilds its content from live debts.
export async function queueDailyReminders(db,{now=new Date(),choose=()=>randomInt(reminderQuotes.length)}={}) {
  if(!isReminderHour(now))return {queued:0,skipped:true};
  const day=reminderDay(now);
  const people=await db.many('users',{claimed:true,email_verified:true,email_notifications:{$ne:false},email:{$type:'string',$ne:''}});
  let queued=0;
  for(const person of people) {
    if((await reminderBalance(db,person.id)).total<=0)continue;
    const quoteIndex=choose();
    if(!Number.isInteger(quoteIndex)||quoteIndex<0||quoteIndex>=reminderQuotes.length)throw Error('Invalid reminder quote selection');
    try {
      await db.insert('email_outbox',{id:`reminder-${day}-${person.id}`,kind:'reminder',user_id:person.id,to:person.email,reminder_day:day,quote_index:quoteIndex,status:'pending',attempts:0,created_at:now,retry_at:now});
      queued++;
    }catch(error){if(error.code!==11000)throw error;}
  }
  return {queued,skipped:false};
}

export async function reminderContent(db,message,recipient,now=new Date()) {
  if(message.reminder_day!==reminderDay(now)||!recipient?.claimed||!recipient.email_verified||recipient.email_notifications===false||recipient.email!==message.to)return null;
  const {total,groups}=await reminderBalance(db,recipient.id);
  if(total<=0)return null;
  const lines=[];
  for(const [id,amount] of groups) {
    const friend=await db.one('users',{id});
    lines.push(`• ${friend?.name||'Your friend'}: ${money(amount)}`);
  }
  return {subject:`${recipient.name}, ${money(total)} still to pay`,text:`Hi ${recipient.name},\n\n${reminderQuote(message.quote_index,recipient.name,total)}\n\nStill to pay: ${money(total)}\n${lines.join('\n')}\n\nThis excludes confirmed payments and money awaiting confirmation. Already transferred money? Open the app and report it with “I’ve paid” so we can stop reminding you about that amount.`};
}
