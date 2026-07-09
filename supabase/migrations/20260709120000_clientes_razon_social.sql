-- Razón social para FACTURA, separada del nombre comercial del cliente.
-- Motivo: el nombre con el que se conoce al cliente (empresa / nombre_contacto) no siempre es
-- la razón social legal que la SET valida contra el RUC en el documento electrónico (SIFEN).
-- El armado del receptor SIFEN usa: razon_social → si está vacío, cae a empresa / nombre_contacto
-- (fallback), por lo que los clientes existentes (razon_social NULL) facturan EXACTO igual que antes.
ALTER TABLE neura.clientes
  ADD COLUMN IF NOT EXISTS razon_social text;
