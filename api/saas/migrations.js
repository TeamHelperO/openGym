/* Schema history of saas.db. Append only: a migration that has shipped is never edited, a change
 * is a new entry. db.js applies the ones a file has not seen yet, each in its own transaction. */
export const MIGRATIONS = [
  /* 1: academies, people, training, finance, supplies, shop */
  `
  CREATE TABLE gyms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    legal_name TEXT NOT NULL DEFAULT '',
    document TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    primary_color TEXT NOT NULL DEFAULT '#2563eb',
    logo_file TEXT,
    logo_version INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE memberships (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    user_id TEXT,
    role TEXT NOT NULL CHECK (role IN ('gym_admin','trainer','student')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    document TEXT NOT NULL DEFAULT '',
    birth_date TEXT,
    goal TEXT NOT NULL DEFAULT '',
    health_notes TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    trainer_member_id TEXT REFERENCES memberships(id) ON DELETE SET NULL,
    invite_code TEXT UNIQUE,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX memberships_user ON memberships(gym_id, user_id) WHERE user_id IS NOT NULL;
  CREATE INDEX memberships_gym_role ON memberships(gym_id, role, status);
  CREATE INDEX memberships_user_id ON memberships(user_id);

  CREATE TABLE workout_templates (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    level TEXT NOT NULL DEFAULT '',
    plan_json TEXT NOT NULL,
    created_by_member TEXT REFERENCES memberships(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX workout_templates_gym ON workout_templates(gym_id, archived);

  CREATE TABLE workout_assignments (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    template_id TEXT REFERENCES workout_templates(id) ON DELETE SET NULL,
    student_member_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    assigned_by_member TEXT REFERENCES memberships(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    start_date TEXT,
    end_date TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    imported_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX workout_assignments_student ON workout_assignments(gym_id, student_member_id, status);

  CREATE TABLE plans (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    interval_months INTEGER NOT NULL DEFAULT 1 CHECK (interval_months BETWEEN 1 AND 24),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES plans(id),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    start_date TEXT NOT NULL,
    due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 28),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled')),
    canceled_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX subscriptions_gym ON subscriptions(gym_id, status);

  CREATE TABLE finance_categories (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
    system_key TEXT,
    UNIQUE (gym_id, kind, name)
  );

  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
    category_id TEXT REFERENCES finance_categories(id) ON DELETE SET NULL,
    description TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    date TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','charge','sale','purchase','cash')),
    source_id TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled')),
    created_by TEXT,
    created_at TEXT NOT NULL,
    canceled_at TEXT
  );
  CREATE INDEX transactions_gym_date ON transactions(gym_id, date);

  CREATE TABLE charges (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
    sale_id TEXT,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    due_date TEXT NOT NULL,
    reference_month TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','canceled')),
    paid_at TEXT,
    paid_amount_cents INTEGER,
    payment_method TEXT,
    transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX charges_sub_month ON charges(subscription_id, reference_month) WHERE subscription_id IS NOT NULL;
  CREATE INDEX charges_gym_status ON charges(gym_id, status, due_date);

  CREATE TABLE suppliers (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    document TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE supply_items (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'un',
    category TEXT NOT NULL DEFAULT '',
    stock_qty REAL NOT NULL DEFAULT 0,
    min_qty REAL NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE purchase_orders (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','received','canceled')),
    notes TEXT NOT NULL DEFAULT '',
    total_cents INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT,
    transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    created_by TEXT,
    created_at TEXT NOT NULL,
    ordered_at TEXT,
    received_at TEXT
  );

  CREATE TABLE purchase_order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'supply' CHECK (kind IN ('supply','product')),
    item_id TEXT NOT NULL,
    name TEXT NOT NULL,
    qty REAL NOT NULL CHECK (qty > 0),
    unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0)
  );

  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    cost_cents INTEGER NOT NULL DEFAULT 0,
    stock_qty REAL NOT NULL DEFAULT 0,
    min_qty REAL NOT NULL DEFAULT 0,
    track_stock INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE stock_movements (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('product','supply')),
    ref_id TEXT NOT NULL,
    qty_delta REAL NOT NULL,
    reason TEXT NOT NULL,
    source_id TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX stock_movements_ref ON stock_movements(gym_id, kind, ref_id);

  CREATE TABLE cash_sessions (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    opening_cents INTEGER NOT NULL DEFAULT 0,
    expected_cents INTEGER,
    counted_cents INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    opened_by TEXT,
    opened_at TEXT NOT NULL,
    closed_by TEXT,
    closed_at TEXT
  );
  CREATE UNIQUE INDEX cash_one_open ON cash_sessions(gym_id) WHERE status = 'open';

  CREATE TABLE cash_movements (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('withdrawal','deposit')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    reason TEXT NOT NULL DEFAULT '',
    created_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sales (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES cash_sessions(id) ON DELETE SET NULL,
    member_id TEXT REFERENCES memberships(id) ON DELETE SET NULL,
    subtotal_cents INTEGER NOT NULL,
    discount_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    paid_cents INTEGER NOT NULL DEFAULT 0,
    change_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','canceled')),
    transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    charge_id TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    canceled_at TEXT
  );
  CREATE INDEX sales_gym_date ON sales(gym_id, created_at);

  CREATE TABLE sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    qty REAL NOT NULL CHECK (qty > 0),
    unit_price_cents INTEGER NOT NULL,
    total_cents INTEGER NOT NULL
  );

  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    gym_id TEXT,
    user_id TEXT,
    action TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    at TEXT NOT NULL
  );
  CREATE INDEX audit_log_gym ON audit_log(gym_id, at);
  `
];
