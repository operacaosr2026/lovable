// Fornecedores que recebem o pagamento dos pedidos (Pagar fornecedor pergunta
// de qual é; o lote guarda em shop_order_payment_batches.supplier e o pedido em
// shop_orders.paid_supplier).
export const SUPPLIERS = ["Alice", "FlowBorder"] as const;

// Fornecedor de sempre: o preço dele é o custo do produto (products.cost +
// histórico de preços). Os outros têm preço próprio (product_supplier_costs).
export const BASE_SUPPLIER = "Alice";
