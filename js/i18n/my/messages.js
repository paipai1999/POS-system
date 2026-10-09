'use strict';

// Myanmar words for messages and errors shown in small notices.
// Keys are the English text exactly as the screens show it; change the right-hand side only.
Object.assign(I18N.dict, {
  'Cannot reach the POS server. Check the Wi-Fi.': 'POS server နှင့် မချိတ်ဆက်နိုင်ပါ။ Wi-Fi ကို စစ်ပါ။',
  'You do not have permission to do that': 'ထိုလုပ်ဆောင်ချက်ကို ခွင့်မပြုထားပါ',
  'Only an admin can do that': 'အက်ဒမင်သာ လုပ်ဆောင်နိုင်သည်',
  'Someone changed this on another device — showing the latest version': 'အခြားစက်တွင် တစ်စုံတစ်ဦးက ပြောင်းထားသည် – နောက်ဆုံးဗားရှင်းကို ပြနေသည်',
  'Log out while offline?': 'အင်တာနက်မရှိဘဲ ထွက်မလား?',
  'Log out anyway': 'ဖြစ်ဖြစ် ထွက်ရန်',
  'Some items are no longer available. Please refresh the menu.': 'ပစ္စည်းအချို့ မရတော့ပါ။ မီနူးကို ပြန်လည်ဖွင့်ပါ။',
  'Your order is empty': 'သင့်အော်ဒါ ဗလာဖြစ်နေသည်',
  'This table link is not valid. Please ask a member of staff.': 'ဤစားပွဲလင့်ခ်သည် မှန်ကန်မှုမရှိပါ။ ဝန်ထမ်းတစ်ဦးကို မေးပါ။',
  'Please wait for a waiter to confirm your earlier requests': 'ယခင်တောင်းဆိုမှုများကို စားပွဲထိုးအတည်ပြုသည်အထိ စောင့်ပါ',
  'The total no longer matches the current prices or tax. Please reopen the order and pay again.': 'စုစုပေါင်းသည် လက်ရှိဈေးနှုန်း သို့မဟုတ် အခွန်နှင့် မကိုက်တော့ပါ။ အော်ဒါကို ပြန်ဖွင့်ပြီး ပြန်ပေးချေပါ။',
  'Cannot pay an empty order': 'ဗလာအော်ဒါကို ပေးချေ၍ မရပါ',
  'Invalid payment method': 'ငွေပေးချေမှုနည်းလမ်း မမှန်ပါ',
  'Already handled by another station': 'အခြားစခန်းက လုပ်ဆောင်ပြီးဖြစ်သည်',
  'That table has an open order': 'ထိုစားပွဲတွင် ဖွင့်ထားသော အော်ဒါရှိသည်',
  'Only unsent open orders can be removed': 'မပို့ရသေးသော ဖွင့်ထားသည့်အော်ဒါများကိုသာ ဖယ်ရှားနိုင်သည်',
  'This person has order history. Deactivate them instead so reports stay accurate.': 'ဤသူတွင် အော်ဒါမှတ်တမ်းရှိသည်။ အစီရင်ခံစာများ မှန်ကန်စေရန် ဖျက်မည့်အစား ရပ်ဆိုင်းပါ။',
  'Only an admin can set up a printer station': 'အက်ဒမင်သာ ပရင်တာစခန်း တပ်ဆင်နိုင်သည်',
  'Only an admin can remove a printer station': 'အက်ဒမင်သာ ပရင်တာစခန်းကို ဖယ်ရှားနိုင်သည်',
  'This printer station is no longer registered': 'ဤပရင်တာစခန်းသည် မှတ်ပုံတင်ထားခြင်း မရှိတော့ပါ',
  '🖨️ Sent to the counter printer': '🖨️ ကောင်တာပရင်တာသို့ ပို့ပြီးပါပြီ',

  "Bills, receipts and kitchen tickets from waiters' phones print here. No station is online, so each device prints for itself.": 'စားပွဲထိုးများ၏ ဖုန်းမှ ဘေလ်၊ ပြေစာနှင့် မီးဖိုချောင်လက်မှတ်များကို ဤနေရာတွင် ပုံနှိပ်ပါမည်။ ဘယ်စခန်းမှ အွန်လိုင်းမရှိသဖြင့် စက်တစ်လုံးချင်းစီက ကိုယ်တိုင် ပုံနှိပ်ပါမည်။',
  'Connected to the POS server': 'POS server နှင့် ချိတ်ဆက်ထားသည်',
  'Cannot reach the POS server. Changes are kept on this device and sent when the connection is back.': 'POS server နှင့် မချိတ်ဆက်နိုင်ပါ။ ပြောင်းလဲမှုများကို ဤစက်တွင် သိမ်းထားပြီး ချိတ်ဆက်မိသည်နှင့် ပို့ပါမည်။',

  'Single-device mode: data stays in this browser. For several devices, use the POS server (see README).': 'စက်တစ်လုံးတည်းမုဒ် – ဒေတာကို ဤ browser တွင်သာ သိမ်းထားသည်။ စက်များစွာအတွက် POS server ကို သုံးပါ (README ကြည့်ပါ)။',
});
