--
-- PostgreSQL database dump (trimmed pg_dump 16 shape)
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET row_security = off;

CREATE TYPE public.order_status AS ENUM (
    'pending',
    'paid',
    'shipped',
    'delivered',
    'cancelled'
);

CREATE TABLE public.categories (
    id integer NOT NULL,
    name character varying(60) NOT NULL,
    description text
);

CREATE SEQUENCE public.categories_id_seq START WITH 1 INCREMENT BY 1;

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);

CREATE TABLE public.suppliers (
    id integer NOT NULL,
    company_name character varying(120) NOT NULL,
    contact_email character varying(254),
    country character varying(60) DEFAULT 'USA'::character varying NOT NULL,
    tier text DEFAULT 'standard'::text,
    CONSTRAINT suppliers_tier_check CHECK ((tier = ANY ((ARRAY['standard'::character varying, 'preferred'::character varying, 'strategic'::character varying])::text[])))
);

CREATE TABLE public.products (
    id integer NOT NULL,
    sku character varying(24) NOT NULL,
    name character varying(160) NOT NULL,
    unit_price numeric(10,2) DEFAULT 0 NOT NULL,
    units_in_stock integer DEFAULT 0,
    discontinued boolean DEFAULT false NOT NULL,
    tags text[],
    category_id integer,
    supplier_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name character varying(120) NOT NULL,
    email character varying(254) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.orders (
    id bigint NOT NULL,
    customer_id uuid NOT NULL,
    status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
    ordered_at timestamp with time zone DEFAULT now() NOT NULL,
    freight numeric(8,2)
);

CREATE TABLE public.order_items (
    order_id bigint NOT NULL,
    product_id integer NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(10,2) NOT NULL
);

INSERT INTO public.categories VALUES (1, 'Beverages', 'Soft drinks, coffees, teas');
INSERT INTO public.categories VALUES (2, 'Condiments', NULL);

COPY public.suppliers (id, company_name) FROM stdin;
1	Acme Ltd
\.

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_email_key UNIQUE (email);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (order_id, product_id);

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);

CREATE INDEX idx_products_category ON public.products USING btree (category_id);
CREATE UNIQUE INDEX idx_orders_customer_ordered_at ON public.orders USING btree (customer_id, ordered_at);
CREATE INDEX idx_products_name_lower ON public.products USING btree (lower((name)::text));

COMMENT ON TABLE public.products IS 'Catalog products';
COMMENT ON COLUMN public.products.unit_price IS 'Price per unit in USD';

GRANT SELECT ON public.products TO readonly;
