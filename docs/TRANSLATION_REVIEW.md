# Hindi Localization Review & Senior Adult Cultural Verification

All Hindi UI strings in [`src/lib/i18n/hi.json`](../src/lib/i18n/hi.json) and Hindi month names in [`src/lib/dates.ts`](../src/lib/dates.ts) are documented below. Before production rollout to group members, have 2–3 Hindi-reading members of the samiti (especially older adults) review the phrasing for natural everyday clarity.

---

## 1. Cultural & Accessibility Context
The user base consists of approximately 10 to 60 adults in India, predominantly older seniors (aged 55–80). The interface design principles mandate:
- **Respectful & Courteous Tone**: Natural Hindi honorifics ("नमस्ते" instead of casual greetings, clear polite action verbs).
- **Culturally Familiar Financial Terminology**: Standard Indian community savings terms understood without formal banking degrees (e.g. *Bachat*, *Rin*, *Muldhan*, *Byaaj*, *Koshadhyaksh*).
- **No Latin / English Jargon**: Avoiding Anglicized transliterations where native words are clear and standard.
- **High Readability**: Clean Devanagari script rendered at 20px+ font size with high contrast (WCAG AAA compliant text).

---

## 2. Key Terms Translation Verification

| Key | English | Hindi Translation (`hi.json`) | Cultural & Senior Citizen Appropriateness Assessment |
|---|---|---|---|
| `appTitle` | Samiti Savings & Loan | समिति बचत एवं ऋण | Standard, formal title for community self-help savings and lending groups in India. |
| `welcomeGreeting` | Namaste | नमस्ते | Universal respectful Indian greeting; culturally warm and familiar for elders. |
| `memberLoginTitle` | Member Sign In | सदस्य लॉग इन | Direct, simple instruction. |
| `pinLabel` | PIN | पिन (PIN) | Includes phonetic English acronym in parentheses to prevent confusion with mobile ATMs. |
| `mySavingsTitle` | My Total Savings | मेरी कुल बचत | Intuitive; uses *Bachat* (the traditional Indian word for personal savings). |
| `myLoanBalanceTitle` | My Loan Amount Owed | मेरा बकाया ऋण | Formal yet easily understood term for borrowings. |
| `principalAmount` | Loan Principal | ऋण मूलधन | Precise financial Hindi term (*Muldhan*) distinguishing principal from interest. |
| `outstandingPrincipal` | Remaining Principal | शेष मूलधन | Clear indicator of remaining borrowed principal. |
| `unpaidInterest` | Unpaid Accrued Interest | बकाया ब्याज | Direct Hindi term for pending interest charges without compounding. |
| `totalOwed` | Total Amount Owed | कुल देय राशि | Explicit total obligation figure. |
| `repaidSoFar` | Repaid So Far | अब तक चुकाया गया | Natural phrasing easily read by seniors. |
| `groupCashOnHand` | Cash Held by Treasurer | कोषाध्यक्ष के पास नकद | Authentic samiti terminology (*Koshadhyaksh* = Treasurer, *Nakad* = physical cash held). |
| `groupTotalSavings` | Total Group Savings | समूह की कुल बचत | Clear group-level transparency figure. |
| `groupLoansOutstanding` | Total Loans Outstanding | कुल बकाया ऋण | Clear pool lending summary. |
| `groupInterestCollected` | Total Interest Collected | कुल एकत्रित ब्याज | Cumulative interest earnings shown for group transparency. |
| `openMyLoan` | View Loan Details | ऋण विवरण देखें | 1-tap navigation button for members. |
| `openMySavings` | View Savings Statement | बचत विवरण देखें | 1-tap navigation button for members. |
| `openMeetings` | View Meeting Schedule | बैठक समय देखें | 1-tap navigation button for members. |
| `printStatement` | Print Statement | विवरण प्रिंट करें | Print-optimized member passbook button. |
| `confirmAndSave` | Confirm and Save | पुष्टि करें और सहेजें | Clear two-step reassurance before financial records are committed. |
| `cancel` | Cancel | रद्द करें | Safe cancellation button. |
| `backToHome` | Back to Home | वापस जाएं | Large, distinct back button. |
| Month names | January .. December | जनवरी .. दिसंबर | Standard Indian Devanagari calendar transliterations. |

---

## 3. Structural Consistency
- **Completeness**: 61/61 keys present in both `en.json` and `hi.json` (zero missing keys verified via automated script).
- **Interpolation & Formatting**: Currency figures consistently formatted with the Indian Rupee symbol (`₹`) and standard Indian numbering system (`₹1,00,000` lakhs/crores).
