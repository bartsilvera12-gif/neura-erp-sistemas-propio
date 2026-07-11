-- RUC para FACTURA, separado del documento de identidad del cliente.
-- En Paraguay la factura SIEMPRE se emite contra un RUC (persona física o empresa); la cédula
-- (solo dígitos, sin guión) identifica a la persona pero no es el dato fiscal. Este campo guarda
-- el RUC que va en el documento electrónico (SIFEN), separado de:
--   - clientes.documento = cédula del cliente (Identificación de una persona)
--   - clientes.ruc        = RUC del cliente (Identificación de una empresa)
-- La emisión usa: ruc_factura → si vacío, cae a ruc / documento (este último solo si tiene forma de
-- RUC, guión + DV). Clientes existentes (ruc_factura NULL) facturan igual que antes por el fallback.
ALTER TABLE neura.clientes
  ADD COLUMN IF NOT EXISTS ruc_factura text;
