'use strict';

// Myanmar words for the Branches tab (several shops from their backup files, side by side).
// Keys are the English text exactly as the screens show it; change the right-hand side only.
Object.assign(I18N.dict, {
  'Branches': 'ဆိုင်ခွဲများ',
  'Branch': 'ဆိုင်ခွဲ',
  'Branch name': 'ဆိုင်ခွဲအမည်',
  'Add backup files': 'ဘက်ခ်အပ်ဖိုင်များ ထည့်ရန်',
  'Include this shop (this device\'s own data)': 'ဤဆိုင် (ဤစက်ရှိ ကိုယ်ပိုင်အချက်အလက်) ကို ထည့်သွင်းမည်',
  'Each shop has its own POS and its own data. To see them together, save a backup from each branch (Settings → Export backup), then add the files here. The files are read in this browser only: nothing is uploaded or kept after you leave this page. A backup shows the shop as it was when it was saved, so save fresh ones first.': 'ဆိုင်တစ်ဆိုင်စီတွင် ကိုယ်ပိုင် POS နှင့် ကိုယ်ပိုင်အချက်အလက် ရှိပါသည်။ ပေါင်း၍ကြည့်လိုပါက ဆိုင်ခွဲတစ်ခုစီမှ ဘက်ခ်အပ်ကို သိမ်းပြီး (ဆက်တင် → ဘက်ခ်အပ် ထုတ်ယူရန်) ဤနေရာတွင် ဖိုင်များကို ထည့်ပါ။ ဖိုင်များကို ဤဘရောက်ဇာတွင်သာ ဖတ်ပါသည်၊ ဤစာမျက်နှာမှ ထွက်လိုက်လျှင် မည်သည့်အရာကိုမျှ အပ်လုဒ်မလုပ်ဘဲ မသိမ်းထားပါ။ ဘက်ခ်အပ်သည် သိမ်းချိန်ကအတိုင်း ဆိုင်၏အခြေအနေကို ပြသသောကြောင့် အသစ်များကို အရင်သိမ်းပါ။',
  'Add the backup file of each branch to compare them.': 'နှိုင်းယှဉ်ရန် ဆိုင်ခွဲတစ်ခုစီ၏ ဘက်ခ်အပ်ဖိုင်ကို ထည့်ပါ။',
  'Best margin': 'အမြတ်ကွာဟချက် အကောင်းဆုံး',
  'All branches': 'ဆိုင်ခွဲအားလုံး',
  'Sales by branch': 'ဆိုင်ခွဲအလိုက် ရောင်းအား',
  'Net profit by branch': 'ဆိုင်ခွဲအလိုက် အသားတင်အမြတ်',
  'The branches use different currencies or number formats, so nothing is added up. Each branch is shown in its own money.': 'ဆိုင်ခွဲများသည် ငွေကြေးအမျိုးအစား သို့မဟုတ် ဂဏန်းပုံစံ မတူသဖြင့် ဘာကိုမျှ ပေါင်းမထားပါ။ ဆိုင်ခွဲတစ်ခုစီကို ကိုယ်ပိုင်ငွေကြေးဖြင့် ပြထားသည်။',
  'Every branch is worked out with its own settings by the same rules as its own Business health tab: sales are after discounts and refunds, before tax; food cost comes from recipes; labour from the salaries recorded as expenses (marked ~ when estimated from staff hours); net profit is after all recorded expenses. Percentages are of that branch\'s sales.': 'ဆိုင်ခွဲတစ်ခုစီကို ကိုယ်ပိုင်ဆက်တင်ဖြင့် ၎င်း၏ လုပ်ငန်းကျန်းမာရေး တက်ဘ်ကဲ့သို့ စည်းမျဉ်းတူညီစွာ တွက်ထားသည်။ ရောင်းအားသည် လျှော့ဈေးနှင့် ပြန်အမ်းငွေ နှုတ်ပြီး အခွန်မတိုင်မီ ဖြစ်သည်။ အစားအစာကုန်ကျစရိတ်သည် ဟင်းချက်နည်းမှ၊ လုပ်ခသည် အသုံးစရိတ်အဖြစ် မှတ်ထားသော လစာမှ (ဝန်ထမ်းနာရီမှ ခန့်မှန်းလျှင် ~ ဖြင့်မှတ်ထားသည်)၊ အသားတင်အမြတ်သည် မှတ်ထားသော အသုံးစရိတ်အားလုံး နှုတ်ပြီးဖြစ်သည်။ ရာခိုင်နှုန်းများသည် ထိုဆိုင်ခွဲ၏ ရောင်းအားအပေါ် မူတည်သည်။',
});

I18N.patterns.push(
  [/^(.+) \(this device\)$/, '$1 (ဤစက်)'],
  [/^(.+) is not a valid POS backup$/, '$1 သည် POS ဘက်ခ်အပ်ဖိုင် မမှန်ကန်ပါ'],
  [/^Some branches have the same name: (.+)\. If two files are the same shop, remove one so its sales are not counted twice$/, 'ဆိုင်ခွဲအချို့တွင် အမည်တူနေသည် – $1။ ဖိုင်နှစ်ခုသည် ဆိုင်တစ်ခုတည်းဖြစ်လျှင် ရောင်းအားကို နှစ်ကြိမ်မရေတွက်စေရန် တစ်ခုကို ဖယ်ရှားပါ'],
  [/^(.+): this backup has no sales, so the figures may not cover the whole period\. Save a fresh backup from that branch$/, '$1 – ဤဘက်ခ်အပ်တွင် ရောင်းအားမရှိသဖြင့် ကာလတစ်ခုလုံးကို မလွှမ်းခြုံနိုင်ပါ။ ထိုဆိုင်ခွဲမှ ဘက်ခ်အပ်အသစ် သိမ်းပါ'],
  [/^(.+): the last sale in this backup is from (.+), so the figures may not cover the whole period\. Save a fresh backup from that branch$/, '$1 – ဤဘက်ခ်အပ်ရှိ နောက်ဆုံးရောင်းချမှုမှာ $2 ဖြစ်သဖြင့် ကာလတစ်ခုလုံးကို မလွှမ်းခြုံနိုင်ပါ။ ထိုဆိုင်ခွဲမှ ဘက်ခ်အပ်အသစ် သိမ်းပါ'],
);
