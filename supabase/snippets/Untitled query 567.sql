INSERT INTO users (id, email, name, status, created_at)
  VALUES (gen_random_uuid(), 'test@example.com', 'Test', 'active', now());
  INSERT INTO customers (id, user_id, status, created_at)
  VALUES (gen_random_uuid(), (SELECT id FROM users WHERE email='test@example.com'), 'active', now());