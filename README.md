# FlowWise ERP

To‘liq ishlaydigan, production-level biznes boshqaruv ilovasini yarating (inventory + sales + CRM + payments + analytics + multi-branch + realtime + offline sync).



====================================

🔥 GLOBAL QAT’IY QOIDALAR



- HECH QACHON AVECO (average cost) ishlatilmasin

- Faqat batch-level FIFO ishlatiladi

- FIFO faqat serverda authoritative

- Backend = yagona “source of truth”

- Har operatsiya transaction ichida

- Idempotency majburiy

- Data integrity buzilmasin



====================================

🏢 TIZIM STRUKTURASI



- 1 ta Main Warehouse

- Cheklanmagan Branch Warehouse

- Har branch:

  - o‘z skladi

  - o‘z userlari



====================================

🔐 AUTH



- Login page (premium)

- username/email + password

- password hashed

- JWT auth



====================================

👤 USERS



CRUD:



- id

- name

- phone

- username/email (unique)

- password

- role

- branch_id



ROLLAR:



- Super Admin

- Branch User (admin + seller)



====================================

🏬 BRANCHES



CRUD (soft delete):



- name

- address



====================================

📦 PRODUCTS



CRUD (soft delete):



- name

- category



====================================

🏭 WAREHOUSES



- Main warehouse

- Har branch uchun warehouse



====================================

🔥 FIFO CORE (LEDGER-BASED)



TABLE: inventory_batches



- id

- product_id

- warehouse_id

- quantity

- remaining

- cost_price

- created_at



TABLE: inventory_movements



- id

- type (purchase, transfer_out, transfer_in, sale, rollback)

- product_id

- warehouse_id

- batch_id

- quantity (+/-)

- ref_id

- created_at



QOIDALAR:



- batches = current state

- movements = immutable history

- Har o‘zgarish movement orqali yozilsin



====================================

🛒 PURCHASE



- Main warehouse



- Yangi batch:

  quantity = X

  remaining = X



- Movement: purchase



====================================

🔄 TRANSFER (MAIN → BRANCH)



BEGIN TRANSACTION



- FIFO bo‘yicha batchlar tanlanadi (FOR UPDATE)



Main:



- remaining kamayadi

- movement: transfer_out



Branch:



- yangi batch yaratiladi

- cost_price o‘zgarmaydi

- movement: transfer_in



COMMIT



====================================

💰 SALES + PAYMENT (POS)



INPUT:



- product_id

- quantity

- sell_price

- customer_id

- amount_paid

- payment_method (CASH / CLICK)



====================================

🔥 FIFO ALGORITHM (STRICT)



BEGIN TRANSACTION



SELECT batches

WHERE product_id = ?

AND warehouse_id = ?

AND remaining > 0

ORDER BY created_at ASC

FOR UPDATE;



required = quantity

total_cost = 0



FOR each batch:



used = MIN(remaining, required)



UPDATE inventory_batches:

remaining -= used



INSERT movement:

type = sale

quantity = -used



total_cost += used × cost_price



required -= used



IF required = 0 BREAK



IF required > 0:

ROLLBACK

ERROR: Not enough stock



COMMIT



====================================

📈 COST & PROFIT



total_sale = sell_price × quantity

profit = total_sale - total_cost



====================================

💳 PAYMENT & DEBT



remaining_debt = total_sale - amount_paid



IF amount_paid > 0:



- payment yoziladi (CASH / CLICK)



IF remaining_debt > 0:



- customer.balance += remaining_debt



====================================

👥 CUSTOMERS



CRUD:



- name

- phone

- balance



====================================

♻️ ROLLBACK



SALE DELETE:



BEGIN TRANSACTION



- movements topiladi

- batch.remaining qaytariladi

- rollback yoziladi

- balance qayta hisoblanadi



COMMIT



====================================

✏️ EDIT



- rollback eski

- qayta yarat yangi



====================================

🔒 CONCURRENCY



- SELECT ... FOR UPDATE

- race condition yo‘q



====================================

🔁 IDEMPOTENCY



- har request unique key

- duplicate yo‘q



====================================

🌐 REALTIME SYNC



- WebSocket / realtime

- Har o‘zgarish push qilinadi



====================================

📶 OFFLINE MODE



LOCAL:



- pending operations



SYNC:



- server FIFO qayta hisoblaydi

- client update oladi



====================================

📊 ANALYTICS



- revenue

- profit (FIFO)

- cash vs click

- inventory aging

- customer debt

- branch performance



====================================

🎨 UI



- dark theme (black + blue)

- premium dashboard

- fast POS



====================================

🔐 SECURITY



- branch isolation

- admin full access



====================================

🎯 FINAL TALAB



- FIFO hech qachon buzilmasin

- Har hisob aniq bo‘lsin

- Payment va qarz to‘g‘ri ishlasin

- Sync real-time bo‘lsin

- Offline xavfsiz ishlasin



====================================

🚀 NATIJA



- Enterprise darajadagi ERP/POS

- Multi-branch + FIFO + CRM + payments + realtime + offline

- Production-ready SaaS

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://zafaruzb.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2c8d10a8-2590-4a42-bcf8-518bdef8533e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
