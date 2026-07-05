CREATE DATABASE IF NOT EXISTS analytics_demo;
USE analytics_demo;

DROP TABLE IF EXISTS dwd_order_detail_di;
DROP TABLE IF EXISTS dwd_user_register_di;

CREATE TABLE dwd_user_register_di (
  user_id BIGINT PRIMARY KEY,
  dt DATE NOT NULL,
  channel VARCHAR(32) NOT NULL,
  country VARCHAR(32) NOT NULL
);

CREATE TABLE dwd_order_detail_di (
  order_id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  pay_amount DECIMAL(12, 2) NOT NULL,
  pay_status VARCHAR(32) NOT NULL,
  dt DATE NOT NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_dt (dt)
);

INSERT INTO dwd_user_register_di (user_id, dt, channel, country) VALUES
  (1001, '2026-07-01', 'ios', 'CN'),
  (1002, '2026-07-01', 'android', 'CN'),
  (1003, '2026-07-02', 'web', 'US'),
  (1004, '2026-07-03', 'ios', 'CN'),
  (1005, '2026-07-04', 'android', 'SG');

INSERT INTO dwd_order_detail_di (order_id, user_id, pay_amount, pay_status, dt) VALUES
  (9001, 1001, 128.00, 'SUCCESS', '2026-07-01'),
  (9002, 1002, 59.90, 'SUCCESS', '2026-07-01'),
  (9003, 1003, 199.00, 'FAILED', '2026-07-02'),
  (9004, 1004, 299.00, 'SUCCESS', '2026-07-03'),
  (9005, 1005, 88.80, 'SUCCESS', '2026-07-04');
