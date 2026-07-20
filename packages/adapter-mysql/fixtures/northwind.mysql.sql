-- Northwind for MySQL/MariaDB — Adminium adapter fixture (M9/05-T13).
--
-- The same 14 tables and FKs as the postgres reference fixture
-- (packages/adapter-postgres/fixtures/northwind.sql) so the generated
-- experience matches across dialects: composite PKs on the join-ish tables,
-- a self-FK (employees.reports_to), classic column types (smallint keys,
-- varchar/char, real prices, blob images) and NO defaults/serials. Data rows
-- are the same representative subset. Loaded by the live test harness with
-- multipleStatements enabled; requires the InnoDB default engine.


-- Self-referential FKs (employees.reports_to) make row order load-bearing under
-- InnoDB, which checks each VALUES row as it lands; postgres checks the whole
-- multi-row INSERT at end of statement, so the shared row order that loads
-- clean there trips MySQL. Standard mysqldump practice: disable FK checks for
-- the duration of the seed. (First caught by the CI mysql leg's first-ever run.)
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE categories (
    category_id smallint NOT NULL,
    category_name varchar(15) NOT NULL,
    description text,
    picture blob,
    CONSTRAINT pk_categories PRIMARY KEY (category_id)
);

CREATE TABLE customer_demographics (
    customer_type_id char(5) NOT NULL,
    customer_desc text,
    CONSTRAINT pk_customer_demographics PRIMARY KEY (customer_type_id)
);

CREATE TABLE customers (
    customer_id char(5) NOT NULL,
    company_name varchar(40) NOT NULL,
    contact_name varchar(30),
    contact_title varchar(30),
    address varchar(60),
    city varchar(15),
    region varchar(15),
    postal_code varchar(10),
    country varchar(15),
    phone varchar(24),
    fax varchar(24),
    CONSTRAINT pk_customers PRIMARY KEY (customer_id)
);

CREATE TABLE customer_customer_demo (
    customer_id char(5) NOT NULL,
    customer_type_id char(5) NOT NULL,
    CONSTRAINT pk_customer_customer_demo PRIMARY KEY (customer_id, customer_type_id),
    CONSTRAINT fk_customer_customer_demo_customers FOREIGN KEY (customer_id)
        REFERENCES customers (customer_id),
    CONSTRAINT fk_customer_customer_demo_customer_demographics FOREIGN KEY (customer_type_id)
        REFERENCES customer_demographics (customer_type_id)
);

CREATE TABLE employees (
    employee_id smallint NOT NULL,
    last_name varchar(20) NOT NULL,
    first_name varchar(10) NOT NULL,
    title varchar(30),
    title_of_courtesy varchar(25),
    birth_date date,
    hire_date date,
    address varchar(60),
    city varchar(15),
    region varchar(15),
    postal_code varchar(10),
    country varchar(15),
    home_phone varchar(24),
    extension varchar(4),
    photo blob,
    notes text,
    reports_to smallint,
    photo_path varchar(255),
    CONSTRAINT pk_employees PRIMARY KEY (employee_id),
    CONSTRAINT fk_employees_employees FOREIGN KEY (reports_to)
        REFERENCES employees (employee_id)
);

CREATE TABLE suppliers (
    supplier_id smallint NOT NULL,
    company_name varchar(40) NOT NULL,
    contact_name varchar(30),
    contact_title varchar(30),
    address varchar(60),
    city varchar(15),
    region varchar(15),
    postal_code varchar(10),
    country varchar(15),
    phone varchar(24),
    fax varchar(24),
    homepage text,
    CONSTRAINT pk_suppliers PRIMARY KEY (supplier_id)
);

CREATE TABLE products (
    product_id smallint NOT NULL,
    product_name varchar(40) NOT NULL,
    supplier_id smallint,
    category_id smallint,
    quantity_per_unit varchar(20),
    unit_price real,
    units_in_stock smallint,
    units_on_order smallint,
    reorder_level smallint,
    discontinued integer NOT NULL,
    CONSTRAINT pk_products PRIMARY KEY (product_id),
    CONSTRAINT fk_products_categories FOREIGN KEY (category_id)
        REFERENCES categories (category_id),
    CONSTRAINT fk_products_suppliers FOREIGN KEY (supplier_id)
        REFERENCES suppliers (supplier_id)
);

CREATE TABLE region (
    region_id smallint NOT NULL,
    region_description char(60) NOT NULL,
    CONSTRAINT pk_region PRIMARY KEY (region_id)
);

CREATE TABLE shippers (
    shipper_id smallint NOT NULL,
    company_name varchar(40) NOT NULL,
    phone varchar(24),
    CONSTRAINT pk_shippers PRIMARY KEY (shipper_id)
);

CREATE TABLE orders (
    order_id smallint NOT NULL,
    customer_id char(5),
    employee_id smallint,
    order_date date,
    required_date date,
    shipped_date date,
    ship_via smallint,
    freight real,
    ship_name varchar(40),
    ship_address varchar(60),
    ship_city varchar(15),
    ship_region varchar(15),
    ship_postal_code varchar(10),
    ship_country varchar(15),
    CONSTRAINT pk_orders PRIMARY KEY (order_id),
    CONSTRAINT fk_orders_customers FOREIGN KEY (customer_id)
        REFERENCES customers (customer_id),
    CONSTRAINT fk_orders_employees FOREIGN KEY (employee_id)
        REFERENCES employees (employee_id),
    CONSTRAINT fk_orders_shippers FOREIGN KEY (ship_via)
        REFERENCES shippers (shipper_id)
);

CREATE TABLE order_details (
    order_id smallint NOT NULL,
    product_id smallint NOT NULL,
    unit_price real NOT NULL,
    quantity smallint NOT NULL,
    discount real NOT NULL,
    CONSTRAINT pk_order_details PRIMARY KEY (order_id, product_id),
    CONSTRAINT fk_order_details_orders FOREIGN KEY (order_id)
        REFERENCES orders (order_id),
    CONSTRAINT fk_order_details_products FOREIGN KEY (product_id)
        REFERENCES products (product_id)
);

CREATE TABLE territories (
    territory_id varchar(20) NOT NULL,
    territory_description char(60) NOT NULL,
    region_id smallint NOT NULL,
    CONSTRAINT pk_territories PRIMARY KEY (territory_id),
    CONSTRAINT fk_territories_region FOREIGN KEY (region_id)
        REFERENCES region (region_id)
);

CREATE TABLE employee_territories (
    employee_id smallint NOT NULL,
    territory_id varchar(20) NOT NULL,
    CONSTRAINT pk_employee_territories PRIMARY KEY (employee_id, territory_id),
    CONSTRAINT fk_employee_territories_employees FOREIGN KEY (employee_id)
        REFERENCES employees (employee_id),
    CONSTRAINT fk_employee_territories_territories FOREIGN KEY (territory_id)
        REFERENCES territories (territory_id)
);

CREATE TABLE us_states (
    state_id smallint NOT NULL,
    state_name varchar(100),
    state_abbr varchar(2),
    state_region varchar(50),
    CONSTRAINT pk_us_states PRIMARY KEY (state_id)
);

-- ---------------------------------------------------------------------------
-- Seed data (representative subset of the classic Northwind rows)
-- ---------------------------------------------------------------------------

INSERT INTO categories (category_id, category_name, description, picture) VALUES
  (1, 'Beverages', 'Soft drinks, coffees, teas, beers, and ales', NULL),
  (2, 'Condiments', 'Sweet and savory sauces, relishes, spreads, and seasonings', NULL),
  (3, 'Confections', 'Desserts, candies, and sweet breads', NULL),
  (4, 'Dairy Products', 'Cheeses', NULL),
  (5, 'Grains/Cereals', 'Breads, crackers, pasta, and cereal', NULL),
  (6, 'Meat/Poultry', 'Prepared meats', NULL),
  (7, 'Produce', 'Dried fruit and bean curd', NULL),
  (8, 'Seafood', 'Seaweed and fish', NULL);

INSERT INTO customer_demographics (customer_type_id, customer_desc) VALUES
  ('RETAL', 'Retail customers buying in small quantities'),
  ('WHOLE', 'Wholesale customers with volume discounts'),
  ('LOYAL', 'Long-standing customers on loyalty terms'),
  ('ONLIN', 'Customers ordering through the web storefront'),
  ('SEASN', 'Seasonal bulk purchasers');

INSERT INTO customers (customer_id, company_name, contact_name, contact_title, address, city, region, postal_code, country, phone, fax) VALUES
  ('ALFKI', 'Alfreds Futterkiste', 'Maria Anders', 'Sales Representative', 'Obere Str. 57', 'Berlin', NULL, '12209', 'Germany', '030-0074321', '030-0076545'),
  ('ANATR', 'Ana Trujillo Emparedados y helados', 'Ana Trujillo', 'Owner', 'Avda. de la Constitución 2222', 'México D.F.', NULL, '05021', 'Mexico', '(5) 555-4729', '(5) 555-3745'),
  ('ANTON', 'Antonio Moreno Taquería', 'Antonio Moreno', 'Owner', 'Mataderos  2312', 'México D.F.', NULL, '05023', 'Mexico', '(5) 555-3932', NULL),
  ('AROUT', 'Around the Horn', 'Thomas Hardy', 'Sales Representative', '120 Hanover Sq.', 'London', NULL, 'WA1 1DP', 'UK', '(171) 555-7788', '(171) 555-6750'),
  ('BERGS', 'Berglunds snabbköp', 'Christina Berglund', 'Order Administrator', 'Berguvsvägen  8', 'Luleå', NULL, 'S-958 22', 'Sweden', '0921-12 34 65', '0921-12 34 67'),
  ('BLAUS', 'Blauer See Delikatessen', 'Hanna Moos', 'Sales Representative', 'Forsterstr. 57', 'Mannheim', NULL, '68306', 'Germany', '0621-08460', '0621-08924'),
  ('BLONP', 'Blondesddsl père et fils', 'Frédérique Citeaux', 'Marketing Manager', '24, place Kléber', 'Strasbourg', NULL, '67000', 'France', '88.60.15.31', '88.60.15.32'),
  ('BOLID', 'Bólido Comidas preparadas', 'Martín Sommer', 'Owner', 'C/ Araquil, 67', 'Madrid', NULL, '28023', 'Spain', '(91) 555 22 82', '(91) 555 91 99'),
  ('BONAP', 'Bon app''', 'Laurence Lebihan', 'Owner', '12, rue des Bouchers', 'Marseille', NULL, '13008', 'France', '91.24.45.40', '91.24.45.41'),
  ('BOTTM', 'Bottom-Dollar Markets', 'Elizabeth Lincoln', 'Accounting Manager', '23 Tsawassen Blvd.', 'Tsawassen', 'BC', 'T2F 8M4', 'Canada', '(604) 555-4729', '(604) 555-3745'),
  ('BSBEV', 'B''s Beverages', 'Victoria Ashworth', 'Sales Representative', 'Fauntleroy Circus', 'London', NULL, 'EC2 5NT', 'UK', '(171) 555-1212', NULL),
  ('CACTU', 'Cactus Comidas para llevar', 'Patricio Simpson', 'Sales Agent', 'Cerrito 333', 'Buenos Aires', NULL, '1010', 'Argentina', '(1) 135-5555', '(1) 135-4892');

INSERT INTO customer_customer_demo (customer_id, customer_type_id) VALUES
  ('ALFKI', 'RETAL'),
  ('ALFKI', 'LOYAL'),
  ('ANATR', 'RETAL'),
  ('AROUT', 'WHOLE'),
  ('BERGS', 'WHOLE'),
  ('BOTTM', 'ONLIN'),
  ('CACTU', 'SEASN');

INSERT INTO employees (employee_id, last_name, first_name, title, title_of_courtesy, birth_date, hire_date, address, city, region, postal_code, country, home_phone, extension, photo, notes, reports_to, photo_path) VALUES
  (1, 'Davolio', 'Nancy', 'Sales Representative', 'Ms.', '1948-12-08', '1992-05-01', '507 - 20th Ave. E. Apt. 2A', 'Seattle', 'WA', '98122', 'USA', '(206) 555-9857', '5467', NULL, 'Education includes a BA in psychology from Colorado State University.', 2, '1.jpg'),
  (2, 'Fuller', 'Andrew', 'Vice President, Sales', 'Dr.', '1952-02-19', '1992-08-14', '908 W. Capital Way', 'Tacoma', 'WA', '98401', 'USA', '(206) 555-9482', '3457', NULL, 'Andrew received his BTS commercial in 1974 and a Ph.D. in international marketing.', NULL, '2.jpg'),
  (3, 'Leverling', 'Janet', 'Sales Representative', 'Ms.', '1963-08-30', '1992-04-01', '722 Moss Bay Blvd.', 'Kirkland', 'WA', '98033', 'USA', '(206) 555-3412', '3355', NULL, 'Janet has a BS degree in chemistry from Boston College.', 2, '3.jpg'),
  (4, 'Peacock', 'Margaret', 'Sales Representative', 'Mrs.', '1937-09-19', '1993-05-03', '4110 Old Redmond Rd.', 'Redmond', 'WA', '98052', 'USA', '(206) 555-8122', '5176', NULL, 'Margaret holds a BA in English literature from Concordia College.', 2, '4.jpg'),
  (5, 'Buchanan', 'Steven', 'Sales Manager', 'Mr.', '1955-03-04', '1993-10-17', '14 Garrett Hill', 'London', NULL, 'SW1 8JR', 'UK', '(71) 555-4848', '3453', NULL, 'Steven Buchanan graduated from St. Andrews University, Scotland, with a BSC degree in 1976.', 2, '5.jpg'),
  (6, 'Suyama', 'Michael', 'Sales Representative', 'Mr.', '1963-07-02', '1993-10-17', 'Coventry House Miner Rd.', 'London', NULL, 'EC2 7JR', 'UK', '(71) 555-7773', '428', NULL, 'Michael is a graduate of Sussex University (MA, economics).', 5, '6.jpg'),
  (7, 'King', 'Robert', 'Sales Representative', 'Mr.', '1960-05-29', '1994-01-02', 'Edgeham Hollow Winchester Way', 'London', NULL, 'RG1 9SP', 'UK', '(71) 555-5598', '465', NULL, 'Robert King served in the Peace Corps and traveled extensively before joining the company.', 5, '7.jpg'),
  (8, 'Callahan', 'Laura', 'Inside Sales Coordinator', 'Ms.', '1958-01-09', '1994-03-05', '4726 - 11th Ave. N.E.', 'Seattle', 'WA', '98105', 'USA', '(206) 555-1189', '2344', NULL, 'Laura received a BA in psychology from the University of Washington.', 2, '8.jpg'),
  (9, 'Dodsworth', 'Anne', 'Sales Representative', 'Ms.', '1966-01-27', '1994-11-15', '7 Houndstooth Rd.', 'London', NULL, 'WG2 7LT', 'UK', '(71) 555-4444', '452', NULL, 'Anne has a BA degree in English from St. Lawrence College.', 5, '9.jpg');

INSERT INTO suppliers (supplier_id, company_name, contact_name, contact_title, address, city, region, postal_code, country, phone, fax, homepage) VALUES
  (1, 'Exotic Liquids', 'Charlotte Cooper', 'Purchasing Manager', '49 Gilbert St.', 'London', NULL, 'EC1 4SD', 'UK', '(171) 555-2222', NULL, NULL),
  (2, 'New Orleans Cajun Delights', 'Shelley Burke', 'Order Administrator', 'P.O. Box 78934', 'New Orleans', 'LA', '70117', 'USA', '(100) 555-4822', NULL, '#CAJUN.HTM#'),
  (3, 'Grandma Kelly''s Homestead', 'Regina Murphy', 'Sales Representative', '707 Oxford Rd.', 'Ann Arbor', 'MI', '48104', 'USA', '(313) 555-5735', '(313) 555-3349', NULL),
  (4, 'Tokyo Traders', 'Yoshi Nagase', 'Marketing Manager', '9-8 Sekimai Musashino-shi', 'Tokyo', NULL, '100', 'Japan', '(03) 3555-5011', NULL, NULL),
  (5, 'Cooperativa de Quesos ''Las Cabras''', 'Antonio del Valle Saavedra', 'Export Administrator', 'Calle del Rosal 4', 'Oviedo', 'Asturias', '33007', 'Spain', '(98) 598 76 54', NULL, NULL),
  (6, 'Mayumi''s', 'Mayumi Ohno', 'Marketing Representative', '92 Setsuko Chuo-ku', 'Osaka', NULL, '545', 'Japan', '(06) 431-7877', NULL, 'Mayumi''s (on the World Wide Web)#http://www.microsoft.com/accessdev/sampleapps/mayumi.htm#'),
  (7, 'Pavlova, Ltd.', 'Ian Devling', 'Marketing Manager', '74 Rose St. Moonie Ponds', 'Melbourne', 'Victoria', '3058', 'Australia', '(03) 444-2343', '(03) 444-6588', NULL),
  (8, 'Specialty Biscuits, Ltd.', 'Peter Wilson', 'Sales Representative', '29 King''s Way', 'Manchester', NULL, 'M14 GSD', 'UK', '(161) 555-4448', NULL, NULL);

INSERT INTO products (product_id, product_name, supplier_id, category_id, quantity_per_unit, unit_price, units_in_stock, units_on_order, reorder_level, discontinued) VALUES
  (1, 'Chai', 1, 1, '10 boxes x 20 bags', 18, 39, 0, 10, 1),
  (2, 'Chang', 1, 1, '24 - 12 oz bottles', 19, 17, 40, 25, 1),
  (3, 'Aniseed Syrup', 1, 2, '12 - 550 ml bottles', 10, 13, 70, 25, 0),
  (4, 'Chef Anton''s Cajun Seasoning', 2, 2, '48 - 6 oz jars', 22, 53, 0, 0, 0),
  (5, 'Chef Anton''s Gumbo Mix', 2, 2, '36 boxes', 21.35, 0, 0, 0, 1),
  (6, 'Grandma''s Boysenberry Spread', 3, 2, '12 - 8 oz jars', 25, 120, 0, 25, 0),
  (7, 'Uncle Bob''s Organic Dried Pears', 3, 7, '12 - 1 lb pkgs.', 30, 15, 0, 10, 0),
  (8, 'Northwoods Cranberry Sauce', 3, 2, '12 - 12 oz jars', 40, 6, 0, 0, 0),
  (9, 'Mishi Kobe Niku', 4, 6, '18 - 500 g pkgs.', 97, 29, 0, 0, 1),
  (10, 'Ikura', 4, 8, '12 - 200 ml jars', 31, 31, 0, 0, 0),
  (11, 'Queso Cabrales', 5, 4, '1 kg pkg.', 21, 22, 30, 30, 0),
  (12, 'Queso Manchego La Pastora', 5, 4, '10 - 500 g pkgs.', 38, 86, 0, 0, 0),
  (13, 'Konbu', 6, 8, '2 kg box', 6, 24, 0, 5, 0),
  (14, 'Tofu', 6, 7, '40 - 100 g pkgs.', 23.25, 35, 0, 0, 0),
  (15, 'Genen Shouyu', 6, 2, '24 - 250 ml bottles', 15.5, 39, 0, 5, 0),
  (16, 'Pavlova', 7, 3, '32 - 500 g boxes', 17.45, 29, 0, 10, 0),
  (17, 'Alice Mutton', 7, 6, '20 - 1 kg tins', 39, 0, 0, 0, 1),
  (18, 'Carnarvon Tigers', 7, 8, '16 kg pkg.', 62.5, 42, 0, 0, 0),
  (19, 'Teatime Chocolate Biscuits', 8, 3, '10 boxes x 12 pieces', 9.2, 25, 0, 5, 0),
  (20, 'Sir Rodney''s Marmalade', 8, 3, '30 gift boxes', 81, 40, 0, 0, 0);

INSERT INTO region (region_id, region_description) VALUES
  (1, 'Eastern'),
  (2, 'Western'),
  (3, 'Northern'),
  (4, 'Southern');

INSERT INTO shippers (shipper_id, company_name, phone) VALUES
  (1, 'Speedy Express', '(503) 555-9831'),
  (2, 'United Package', '(503) 555-3199'),
  (3, 'Federal Shipping', '(503) 555-9931'),
  (4, 'Alliance Shippers', '1-800-222-0451'),
  (5, 'UPS', '1-800-782-7892'),
  (6, 'DHL', '1-800-225-5345');

INSERT INTO territories (territory_id, territory_description, region_id) VALUES
  ('01581', 'Westboro', 1),
  ('01730', 'Bedford', 1),
  ('02116', 'Boston', 1),
  ('02139', 'Cambridge', 1),
  ('06897', 'Wilton', 1),
  ('30346', 'Atlanta', 4),
  ('33607', 'Tampa', 4),
  ('48075', 'Southfield', 3),
  ('55113', 'Roseville', 3),
  ('60179', 'Hoffman Estates', 2),
  ('75234', 'Dallas', 4),
  ('85014', 'Phoenix', 2),
  ('94025', 'Menlo Park', 2),
  ('98004', 'Bellevue', 2),
  ('98052', 'Redmond', 2);

INSERT INTO employee_territories (employee_id, territory_id) VALUES
  (1, '06897'),
  (1, '01581'),
  (2, '01730'),
  (2, '02116'),
  (2, '02139'),
  (3, '30346'),
  (3, '33607'),
  (4, '48075'),
  (4, '55113'),
  (5, '60179'),
  (6, '75234'),
  (7, '85014'),
  (8, '94025'),
  (9, '98004'),
  (9, '98052');

INSERT INTO orders (order_id, customer_id, employee_id, order_date, required_date, shipped_date, ship_via, freight, ship_name, ship_address, ship_city, ship_region, ship_postal_code, ship_country) VALUES
  (10248, 'ALFKI', 5, '1996-07-04', '1996-08-01', '1996-07-16', 3, 32.38, 'Alfreds Futterkiste', 'Obere Str. 57', 'Berlin', NULL, '12209', 'Germany'),
  (10249, 'ANATR', 6, '1996-07-05', '1996-08-16', '1996-07-10', 1, 11.61, 'Ana Trujillo Emparedados y helados', 'Avda. de la Constitución 2222', 'México D.F.', NULL, '05021', 'Mexico'),
  (10250, 'ANTON', 4, '1996-07-08', '1996-08-05', '1996-07-12', 2, 65.83, 'Antonio Moreno Taquería', 'Mataderos  2312', 'México D.F.', NULL, '05023', 'Mexico'),
  (10251, 'AROUT', 3, '1996-07-08', '1996-08-05', '1996-07-15', 1, 41.34, 'Around the Horn', '120 Hanover Sq.', 'London', NULL, 'WA1 1DP', 'UK'),
  (10252, 'BERGS', 4, '1996-07-09', '1996-08-06', '1996-07-11', 2, 51.30, 'Berglunds snabbköp', 'Berguvsvägen  8', 'Luleå', NULL, 'S-958 22', 'Sweden'),
  (10253, 'BLAUS', 3, '1996-07-10', '1996-07-24', '1996-07-16', 2, 58.17, 'Blauer See Delikatessen', 'Forsterstr. 57', 'Mannheim', NULL, '68306', 'Germany'),
  (10254, 'BLONP', 5, '1996-07-11', '1996-08-08', '1996-07-23', 2, 22.98, 'Blondesddsl père et fils', '24, place Kléber', 'Strasbourg', NULL, '67000', 'France'),
  (10255, 'BOLID', 9, '1996-07-12', '1996-08-09', '1996-07-15', 3, 148.33, 'Bólido Comidas preparadas', 'C/ Araquil, 67', 'Madrid', NULL, '28023', 'Spain'),
  (10256, 'BONAP', 3, '1996-07-15', '1996-08-12', '1996-07-17', 2, 13.97, 'Bon app''', '12, rue des Bouchers', 'Marseille', NULL, '13008', 'France'),
  (10257, 'BOTTM', 4, '1996-07-16', '1996-08-13', '1996-07-22', 3, 81.91, 'Bottom-Dollar Markets', '23 Tsawassen Blvd.', 'Tsawassen', 'BC', 'T2F 8M4', 'Canada'),
  (10258, 'BSBEV', 1, '1996-07-17', '1996-08-14', '1996-07-23', 1, 140.51, 'B''s Beverages', 'Fauntleroy Circus', 'London', NULL, 'EC2 5NT', 'UK'),
  (10259, 'CACTU', 4, '1996-07-18', '1996-08-15', '1996-07-25', 3, 3.25, 'Cactus Comidas para llevar', 'Cerrito 333', 'Buenos Aires', NULL, '1010', 'Argentina'),
  (10260, 'ALFKI', 4, '1996-07-19', '1996-08-16', '1996-07-29', 1, 55.09, 'Alfreds Futterkiste', 'Obere Str. 57', 'Berlin', NULL, '12209', 'Germany'),
  (10261, 'AROUT', 4, '1996-07-19', '1996-08-16', '1996-07-30', 2, 3.05, 'Around the Horn', '120 Hanover Sq.', 'London', NULL, 'WA1 1DP', 'UK'),
  (10262, 'BERGS', 8, '1996-07-22', '1996-08-19', '1996-07-25', 3, 48.29, 'Berglunds snabbköp', 'Berguvsvägen  8', 'Luleå', NULL, 'S-958 22', 'Sweden'),
  (10263, 'BONAP', 9, '1996-07-23', '1996-08-20', '1996-07-31', 3, 146.06, 'Bon app''', '12, rue des Bouchers', 'Marseille', NULL, '13008', 'France'),
  (10264, 'BOTTM', 6, '1996-07-24', '1996-08-21', '1996-08-23', 3, 3.67, 'Bottom-Dollar Markets', '23 Tsawassen Blvd.', 'Tsawassen', 'BC', 'T2F 8M4', 'Canada'),
  (10265, 'BLONP', 2, '1996-07-25', '1996-08-22', '1996-08-12', 1, 55.28, 'Blondesddsl père et fils', '24, place Kléber', 'Strasbourg', NULL, '67000', 'France');

INSERT INTO order_details (order_id, product_id, unit_price, quantity, discount) VALUES
  (10248, 11, 14, 12, 0),
  (10248, 1, 9.8, 10, 0),
  (10248, 12, 34.8, 5, 0),
  (10249, 14, 18.6, 9, 0),
  (10249, 20, 42.4, 40, 0),
  (10250, 1, 7.7, 10, 0),
  (10250, 20, 42.4, 35, 0.15),
  (10250, 16, 16.8, 15, 0.15),
  (10251, 3, 16.8, 6, 0.05),
  (10251, 19, 15.6, 15, 0.05),
  (10251, 20, 16.8, 20, 0),
  (10252, 4, 64.8, 40, 0.05),
  (10252, 5, 2, 25, 0.05),
  (10252, 16, 27.2, 40, 0),
  (10253, 10, 10, 20, 0),
  (10253, 13, 9.2, 42, 0),
  (10253, 16, 14.4, 40, 0),
  (10254, 1, 8, 15, 0.15),
  (10254, 15, 19.8, 21, 0.15),
  (10254, 19, 8, 21, 0),
  (10255, 2, 15.2, 20, 0),
  (10255, 5, 13.9, 35, 0),
  (10255, 9, 15.2, 25, 0),
  (10255, 12, 44, 30, 0),
  (10256, 15, 16.8, 15, 0),
  (10256, 17, 26.2, 12, 0),
  (10257, 11, 35.1, 25, 0),
  (10257, 14, 30.4, 6, 0),
  (10257, 19, 21, 15, 0),
  (10258, 1, 15.2, 50, 0.2),
  (10258, 2, 50, 65, 0.2),
  (10258, 5, 27.8, 6, 0.2),
  (10259, 10, 8, 10, 0),
  (10259, 13, 65.4, 1, 0),
  (10260, 1, 16, 16, 0.25),
  (10260, 14, 47.5, 50, 0),
  (10260, 18, 39.4, 15, 0.25),
  (10260, 20, 12, 21, 0.25),
  (10261, 1, 8, 20, 0),
  (10261, 20, 12.8, 20, 0),
  (10262, 5, 26.2, 12, 0.2),
  (10262, 7, 30, 15, 0),
  (10262, 8, 40, 2, 0),
  (10263, 9, 97, 9, 0.25),
  (10263, 14, 23.25, 5, 0),
  (10263, 16, 17.45, 21, 0.25),
  (10263, 20, 81, 30, 0.25),
  (10264, 2, 15.2, 35, 0),
  (10264, 3, 10, 25, 0.15),
  (10265, 1, 18, 30, 0),
  (10265, 4, 22, 20, 0),
  (10265, 17, 39, 15, 0);

INSERT INTO us_states (state_id, state_name, state_abbr, state_region) VALUES
  (1, 'Alabama', 'AL', 'south'),
  (2, 'Alaska', 'AK', 'north'),
  (3, 'Arizona', 'AZ', 'west'),
  (4, 'Arkansas', 'AR', 'south'),
  (5, 'California', 'CA', 'west'),
  (6, 'Colorado', 'CO', 'west'),
  (7, 'Connecticut', 'CT', 'east'),
  (8, 'Delaware', 'DE', 'east'),
  (9, 'Florida', 'FL', 'south'),
  (10, 'Georgia', 'GA', 'south'),
  (11, 'Hawaii', 'HI', 'west'),
  (12, 'Idaho', 'ID', 'west'),
  (13, 'Illinois', 'IL', 'midwest'),
  (14, 'Indiana', 'IN', 'midwest'),
  (15, 'Iowa', 'IA', 'midwest'),
  (16, 'Kansas', 'KS', 'midwest'),
  (17, 'Kentucky', 'KY', 'south'),
  (18, 'Louisiana', 'LA', 'south'),
  (19, 'Maine', 'ME', 'east'),
  (20, 'Washington', 'WA', 'west');



SET FOREIGN_KEY_CHECKS = 1;
