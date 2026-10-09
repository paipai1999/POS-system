'use strict';

// Myanmar words for selling on account: the credit limit, customers paying what they owe, the statement and the receivables.
// Keys are the English text exactly as the screens show it; change the right-hand side only.
Object.assign(I18N.dict, {
  // Customers
  'Owes': 'ပေးရန်ကျန်',
  'Receive payment': 'ငွေလက်ခံရန်',
  'Statement': 'စာရင်းရှင်းတမ်း',
  'Credit limit (0 = no credit)': 'အကြွေးကန့်သတ်ငွေ (၀ = အကြွေးမရ)',
  'Owes now': 'ယခု ပေးရန်ကျန်',
  'Balance': 'လက်ကျန်',
  "A manager sets a customer's points, standing discount and credit limit.": 'ဖောက်သည်၏ ဆုမှတ်၊ အမြဲတမ်းလျှော့ဈေးနှင့် အကြွေးကန့်သတ်ငွေကို မန်နေဂျာက သတ်မှတ်ပါသည်။',
  'In credit': 'ပိုပေးထားသည်',
  'Limit': 'ကန့်သတ်ငွေ',
  'Amount received': 'လက်ခံရရှိငွေ',
  'Cash goes into the drawer of the open shift.': 'ငွေသားကို ဖွင့်ထားသော အချိန်ပိုင်း၏ ငွေအံဆွဲထဲ ထည့်ပါမည်။',
  'Record payment': 'ငွေလက်ခံမှု မှတ်ရန်',
  'Write off…': 'အကြွေးဖျက်ရန်…',
  'Payment recorded': 'ငွေလက်ခံမှု မှတ်ပြီး',
  'Written off': 'ဖျက်ပြီး',
  'Bill on account': 'အကြွေးဘေလ်',
  'Bill refunded': 'ပြန်အမ်းသော ဘေလ်',
  'Earlier balance': 'ယခင်လက်ကျန်',
  'Payment in cash': 'ငွေသားဖြင့် ပေးချေ',
  'Payment by card': 'ကတ်ဖြင့် ပေးချေ',
  'Payment by bank / wallet': 'ဘဏ်/ပိုက်ဆံအိတ်ဖြင့် ပေးချေ',
  'Nothing on this account yet': 'ဤအကောင့်တွင် ဘာမှမရှိသေးပါ',
  'credit limit': 'အကြွေးကန့်သတ်ငွေ',
  'Choose how the customer paid': 'ဖောက်သည် ပေးချေသည့်နည်း ရွေးပါ',

  // Checkout
  '🧾 On account': '🧾 အကြွေး',
  'On account': 'အကြွေး',
  'owes': 'ပေးရန်ကျန်',
  'available': 'သုံးနိုင်သည်',
  'The whole bill goes on their account and is paid later. A tip cannot be put on account.': 'ဘေလ်တစ်ခုလုံးကို သူ၏အကောင့်ပေါ် တင်ပြီး နောက်မှ ပေးချေမည်။ တစ်ပ်ငွေကို အကြွေးတင်၍ မရပါ။',
  'Choose a customer with credit': 'အကြွေးရနိုင်သော ဖောက်သည်ကို ရွေးပါ',
  'A tip cannot be put on account': 'တစ်ပ်ငွေကို အကြွေးတင်၍ မရပါ',
  'More than the customer can put on account': 'ဖောက်သည်အကြွေးတင်နိုင်သည်ထက် များနေသည်',

  // Receivables
  'Receivables': 'ရရန်ရှိသော အကြွေး',
  'Owed by customers': 'ဖောက်သည်များ ပေးရန်ကျန်',
  'Customers in credit': 'ပိုပေးထားသော ဖောက်သည်များ',
  'Customers paying their accounts': 'အကောင့်ပေါ်မှ ပေးချေသော ဖောက်သည်များ',
  'Over 60 days': 'ရက် ၆၀ ကျော်',
  'Time to remind them': 'သတိပေးရန် အချိန်ရောက်ပြီ',
  'customers': 'ဖောက်သည်',
  '0-30 days': '၀-၃၀ ရက်',
  '31-60 days': '၃၁-၆၀ ရက်',
  '61-90 days': '၆၁-၉၀ ရက်',
  'Over 90 days': '၉၀ ရက်ကျော်',
  'Oldest bill': 'အဟောင်းဆုံးဘေလ်',
  'Total': 'စုစုပေါင်း',
  'No customer owes anything': 'ပေးရန်ကျန်သော ဖောက်သည် မရှိပါ',
  'A bill is put on account at checkout for a customer who has a credit limit (set in Customers by a manager). Payments settle the oldest bills first. Debts that will not be paid can be written off; they count as an expense.': 'အကြွေးကန့်သတ်ငွေရှိသော ဖောက်သည်အတွက် ငွေရှင်းချိန်တွင် ဘေလ်ကို အကောင့်ပေါ် တင်နိုင်သည် (မန်နေဂျာက ဖောက်သည်စာမျက်နှာတွင် သတ်မှတ်ပါ)။ ပေးငွေများသည် အဟောင်းဆုံးဘေလ်ကို အရင်ရှင်းပါသည်။ မပေးနိုင်တော့သော အကြွေးကို ဖျက်နိုင်ပြီး အသုံးစရိတ်အဖြစ် ရေတွက်ပါသည်။',
  'Bad debts written off': 'ဖျက်ပစ်ခဲ့သော အကြွေးဆိုး',
  'Sold on account': 'အကြွေးရောင်းချငွေ',
  'Customers paid their accounts': 'အကြွေးပြန်ပေးသော ဖောက်သည်များ',
  'Cash received on accounts': 'အကြွေးပြန်ရ ငွေသား',

  // Activity log
  'customer paid': 'ဖောက်သည် ငွေပေးချေ',
  'debt written off': 'အကြွေးဖျက်ပစ်',
  'customer payment voided': 'ဖောက်သည်ငွေပေးချေမှု ပယ်ဖျက်',

  // Messages from the checks
  'Choose a customer to put the bill on account': 'ဘေလ်ကို အကြွေးတင်ရန် ဖောက်သည်ကို ရွေးပါ',
  'A bill on account cannot have a tip': 'အကြွေးဘေလ်တွင် တစ်ပ်ငွေ မထည့်ရပါ',
  'Only the bill itself can be put on account, not the tip': 'ဘေလ်ကိုသာ အကြွေးတင်နိုင်သည်၊ တစ်ပ်ငွေကို မတင်နိုင်ပါ',
  'Only a manager can set a credit limit': 'အကြွေးကန့်သတ်ငွေကို မန်နေဂျာသာ သတ်မှတ်နိုင်သည်',
  'The credit limit cannot be negative': 'အကြွေးကန့်သတ်ငွေသည် အနုတ် မဖြစ်ရပါ',
  'A payment cannot be deleted. Void it instead.': 'ငွေပေးချေမှုကို ဖျက်၍မရပါ။ ပယ်ဖျက်ပါ။',
  'A payment cannot be edited. Void it and enter it again.': 'ငွေပေးချေမှုကို ပြင်၍မရပါ။ ပယ်ဖျက်ပြီး ပြန်ထည့်ပါ။',
  'This payment is already void': 'ဤငွေပေးချေမှုကို ပယ်ဖျက်ပြီးဖြစ်သည်',
  'That customer no longer exists': 'ထိုဖောက်သည် မရှိတော့ပါ',
});

I18N.patterns.push(
  // (a trailing "." or "?" is removed before matching and put back after, so these end without one)
  [/^Payment from (.+)$/, '$1 ထံမှ ငွေလက်ခံမှု'],
  [/^Statement · (.+)$/, 'စာရင်းရှင်းတမ်း · $1'],
  [/^Write off what (.+) owes$/, '$1 ပေးရန်ကျန်သည်ကို ဖျက်ပါ'],
  [/^Write off (.+)$/, '$1 ကို အကြွေးအဖြစ် ဖျက်ပစ်မလား'],
  [/^(.+) will no longer owe this\. It is counted as an expense \(bad debt\)$/, '$1 မှာ ဤငွေကို မပေးရတော့ပါ။ အသုံးစရိတ် (အကြွေးဆိုး) အဖြစ် ရေတွက်ပါမည်'],
  [/^(.+) can put up to (.+) on account$/, '$1 သည် $2 အထိ အကြွေးတင်နိုင်သည်'],
  [/^Credit limit: only (.+) is available for (.+)$/, 'အကြွေးကန့်သတ်ငွေ - $2 အတွက် $1 သာ သုံးနိုင်သည်'],
  [/^(.+) has no credit\. A manager can set a credit limit$/, '$1 တွင် အကြွေးမရှိပါ။ မန်နေဂျာက အကြွေးကန့်သတ်ငွေ သတ်မှတ်နိုင်သည်'],
  [/^(.+) is not active$/, '$1 သည် အသုံးမပြုတော့ပါ'],
  [/^(.+) owes money\. Settle or write off the account first$/, '$1 မှာ ပေးရန်ကျန်နေသည်။ အကောင့်ကို အရင်ရှင်းပါ သို့မဟုတ် ဖျက်ပါ'],
  [/^Only (.+) is owed by (.+)$/, '$2 ပေးရန်ကျန်သည်မှာ $1 သာ ရှိသည်']
);
