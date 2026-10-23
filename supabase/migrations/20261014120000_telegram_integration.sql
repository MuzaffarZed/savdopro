-- ==============================================================================
-- Telegram Bot Integratsiyasi & Mijozlarni Xavfsiz Bog'lash Migratsiyasi
-- Loyiha: SavdoPro POS APP
-- Dasturchi: MuzaffarZed
-- ==============================================================================

-- 1. Mijozlarning Telegram bog'lanishlari jadvali
CREATE TABLE IF NOT EXISTS public.customer_telegram_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    telegram_chat_id BIGINT UNIQUE,
    telegram_username TEXT,
    link_status TEXT NOT NULL DEFAULT 'not_linked' CHECK (link_status IN ('not_linked', 'linked', 'disconnected')),
    token_hash TEXT,
    token_expires_at TIMESTAMPTZ,
    linked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_customer_telegram_link UNIQUE (customer_id)
);

-- Indekslar
CREATE INDEX IF NOT EXISTS idx_customer_telegram_links_cust_id ON public.customer_telegram_links(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_telegram_links_chat_id ON public.customer_telegram_links(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_customer_telegram_links_token_hash ON public.customer_telegram_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_customer_telegram_links_status ON public.customer_telegram_links(link_status);

-- 2. Telegram Xabarlar Jurnali va Chiqish Navbati (Outbox Queue & Audit Log)
CREATE TABLE IF NOT EXISTS public.telegram_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
    payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('sale', 'payment', 'test')),
    telegram_chat_id BIGINT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
    telegram_message_id BIGINT,
    payload JSONB,
    formatted_text TEXT NOT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ
);

-- Indekslar
CREATE INDEX IF NOT EXISTS idx_telegram_messages_status ON public.telegram_messages(status);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_idempotency ON public.telegram_messages(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_customer ON public.telegram_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_created_at ON public.telegram_messages(created_at DESC);

-- 3. Telegram Bot Sozlamalari Jadvali
CREATE TABLE IF NOT EXISTS public.telegram_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_token TEXT,
    bot_username TEXT,
    business_name TEXT DEFAULT 'SavdoPro',
    auto_send_sale BOOLEAN NOT NULL DEFAULT true,
    auto_send_payment BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS (Row Level Security) yoqish
ALTER TABLE public.customer_telegram_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_settings ENABLE ROW LEVEL SECURITY;

-- Xodimlar uchun o'qish va yozish qoidalari
CREATE POLICY "Allow all authenticated users full access to customer_telegram_links"
    ON public.customer_telegram_links FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all authenticated users full access to telegram_messages"
    ON public.telegram_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all authenticated users full access to telegram_settings"
    ON public.telegram_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anonim/ochiq o'qish yoki bot webhook uchun cheklangan siyosat
CREATE POLICY "Allow anon read token_hash for verification"
    ON public.customer_telegram_links FOR SELECT TO anon USING (token_hash IS NOT NULL);
