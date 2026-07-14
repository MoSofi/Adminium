# This file is auto-generated from the current state of the database.
ActiveRecord::Schema[7.1].define(version: 2024_06_12_101500) do
  enable_extension "plpgsql"

  create_table "categories", force: :cascade do |t|
    t.string "name", limit: 60, null: false
    t.text "description"
    t.index ["name"], name: "index_categories_on_name", unique: true
  end

  create_table "suppliers", force: :cascade do |t|
    t.string "company_name", limit: 120, null: false, comment: "Legal company name"
    t.string "contact_email"
    t.timestamps
  end

  create_table "products", force: :cascade do |t|
    t.string "sku", limit: 24, null: false
    t.string "name", limit: 160, null: false
    t.decimal "unit_price", precision: 10, scale: 2, default: "0.0", null: false
    t.boolean "active", default: true, null: false
    t.references "category", foreign_key: true
    t.references "supplier", null: false, foreign_key: { to_table: "suppliers", on_delete: :restrict }
    t.datetime "created_at", null: false
    t.index ["sku"], name: "index_products_on_sku", unique: true
  end

  create_table "customers", id: :uuid, force: :cascade do |t|
    t.string "full_name", limit: 120, null: false
    t.string "email", null: false
    t.index ["email"], name: "index_customers_on_email", unique: true
  end

  create_table "orders", force: :cascade do |t|
    t.uuid "customer_id", null: false
    t.string "status", default: "pending", null: false
    t.datetime "ordered_at", default: -> { "now()" }, null: false
    t.check_constraint "status IN ('pending', 'paid', 'shipped', 'cancelled')", name: "orders_status_check"
  end

  create_table "order_items", id: false, force: :cascade do |t|
    t.bigint "order_id", null: false
    t.bigint "product_id", null: false
    t.integer "quantity", default: 1, null: false
    t.decimal "unit_price", precision: 10, scale: 2, null: false
    t.index ["order_id", "product_id"], name: "index_order_items_on_order_and_product", unique: true
  end

  add_index "orders", ["customer_id"], name: "index_orders_on_customer_id"
  add_foreign_key "orders", "customers", on_delete: :cascade
  add_foreign_key "order_items", "orders", on_delete: :cascade
  add_foreign_key "order_items", "products"
end
