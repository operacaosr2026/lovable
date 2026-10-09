import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { startShopifyOAuth } from "@/lib/shop-orders.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

const CALLBACK_URL = "https://lojas-one.vercel.app/api/public/shopify/callback";

// Escopos pra marcar no app da loja na Shopify (todos). A conexão pede só os
// que o sistema usa (SHOPIFY_SCOPES em shop-orders.functions.ts).
const APP_SCOPES = "read_all_orders,read_analytics,read_analytics_annotations,write_analytics_annotations,read_app_proxy,write_app_proxy,read_apps,read_assigned_fulfillment_orders,write_assigned_fulfillment_orders,read_audit_events,read_customer_events,read_cart_transforms,write_cart_transforms,read_all_cart_transforms,read_validations,write_validations,read_cash_tracking,write_cash_tracking,read_channels,write_channels,read_checkout_kit_enhanced_buyer_events,read_checkout_and_accounts_configurations,write_checkout_and_accounts_configurations,read_checkout_branding_settings,write_checkout_branding_settings,write_checkouts,read_checkouts,read_companies,write_companies,read_custom_fulfillment_services,write_custom_fulfillment_services,read_custom_pixels,write_custom_pixels,read_customers,write_customers,read_customer_data_erasure,write_customer_data_erasure,read_customer_payment_methods,read_customer_merge,write_customer_merge,read_delivery_customizations,write_delivery_customizations,read_price_rules,write_price_rules,read_discounts,write_discounts,read_discovery,write_discovery,write_draft_orders,read_draft_orders,read_files,write_files,read_fulfillment_constraint_rules,write_fulfillment_constraint_rules,read_fulfillments,write_fulfillments,read_gift_card_transactions,write_gift_card_transactions,read_gift_cards,write_gift_cards,write_inventory,read_inventory,read_inventory_purchase_orders,write_inventory_shipments,read_inventory_shipments,write_inventory_shipments_received_items,read_inventory_shipments_received_items,write_inventory_transfers,read_inventory_transfers,read_legal_policies,write_legal_policies,read_delivery_option_generators,write_delivery_option_generators,read_locales,write_locales,write_locations,read_locations,read_marketing_integrated_campaigns,write_marketing_integrated_campaigns,write_marketing_events,read_marketing_events,read_markets,write_markets,read_markets_home,write_markets_home,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_online_store_navigation,write_online_store_navigation,read_online_store_pages,write_online_store_pages,write_order_edits,read_order_edits,read_orders,write_orders,write_packing_slip_templates,read_packing_slip_templates,write_payment_mandate,read_payment_mandate,read_payment_notifications,write_payment_notifications,read_payment_terms,write_payment_terms,read_payment_customizations,write_payment_customizations,read_privacy_settings,write_privacy_settings,read_product_feeds,write_product_feeds,read_product_listings,write_product_listings,read_products,write_products,read_publications,write_publications,read_purchase_options,write_purchase_options,write_reports,read_reports,read_resource_feedbacks,write_resource_feedbacks,read_returns,write_returns,read_rollouts,read_script_tags,write_script_tags,read_shopify_payments_provider_accounts_sensitive,read_shipping,write_shipping,read_shopify_payments_accounts,read_shopify_payments_payouts,read_shopify_payments_bank_accounts,read_shopify_payments_disputes,write_shopify_payments_disputes,read_content,write_content,read_store_credit_account_transactions,write_store_credit_account_transactions,read_store_credit_accounts,write_own_subscription_contracts,read_own_subscription_contracts,write_theme_code,read_themes,write_themes,read_third_party_fulfillment_orders,write_third_party_fulfillment_orders,read_translations,write_translations,read_pixels,write_pixels,customer_read_companies,customer_write_companies,customer_write_customers,customer_read_customers,customer_read_draft_orders,customer_read_markets,customer_read_metaobjects,customer_read_orders,customer_write_orders,customer_read_store_credit_account_transactions,customer_read_store_credit_accounts,customer_write_own_subscription_contracts,customer_read_own_subscription_contracts,unauthenticated_write_bulk_operations,unauthenticated_read_bulk_operations,unauthenticated_read_bundles,unauthenticated_write_checkouts,unauthenticated_read_checkouts,unauthenticated_write_customers,unauthenticated_read_customers,unauthenticated_read_customer_tags,unauthenticated_read_metaobjects,unauthenticated_read_product_pickup_locations,unauthenticated_read_product_inventory,unauthenticated_read_product_listings,unauthenticated_read_product_tags,unauthenticated_read_selling_plans,unauthenticated_read_shop_pay_installments_pricing,unauthenticated_read_content";

function CopyBlock({ text, preview, label }: { text: string; preview?: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => { setCopied(true); toast.success(`${label} copiado`); setTimeout(() => setCopied(false), 2000); },
      () => toast.error("Não foi possível copiar"),
    );
  };
  return (
    <div className="flex items-center gap-2 min-w-0 bg-background rounded px-2 py-1">
      <code className="flex-1 min-w-0 text-[11px] truncate">{preview ?? text}</code>
      <button
        type="button"
        onClick={copy}
        className="h-7 px-2 rounded-md border border-border text-[11px] font-medium text-foreground flex items-center gap-1 hover:bg-muted shrink-0"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

export function ConnectStoreDialog({ open, onClose, onConnected, initialName, replacePlaceholderId }: {
  open: boolean; onClose: () => void; onConnected?: (s: any) => void;
  initialName?: string; replacePlaceholderId?: string;
}) {
  const startOAuth = useServerFn(startShopifyOAuth);
  const [name, setName] = useState(initialName ?? "");
  const [domain, setDomain] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const m = useMutation({
    mutationFn: () => startOAuth({ data: {
      name: name.trim(),
      shop_domain: domain.trim(),
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      replace_placeholder_id: replacePlaceholderId,
    } }),
    onSuccess: (r: any) => { if (r?.url) window.location.href = r.url; },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Conectar loja Shopify</DialogTitle></DialogHeader>
        {/* min-w-0: o DialogContent é grid; sem isso o texto longo da URL alarga tudo. */}
        <div className="space-y-3 min-w-0">
          <div className="min-w-0 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Como obter as credenciais:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Na sua loja Shopify, vá em <strong>Settings → Apps and sales channels → Develop apps</strong>.</li>
              <li>Crie um app, abra a aba <strong>Configuration</strong> e cole esta URL em <strong>Allowed redirection URL(s)</strong>:</li>
            </ol>
            <CopyBlock text={CALLBACK_URL} label="URL" />
            <p>Em <strong>Admin API access scopes</strong>, cole todos os escopos:</p>
            <CopyBlock
              text={APP_SCOPES}
              preview={`${APP_SCOPES.split(",").length} escopos (read_all_orders, read_analytics, …)`}
              label="Escopos"
            />
            <p>Salve, vá em <strong>API credentials</strong> e copie <strong>Client ID</strong> e <strong>Client secret</strong>.</p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Nome</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Minha loja" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Domínio</label>
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="minha-loja.myshopify.com" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Client ID</label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="ex: 1a2b3c4d..." />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Client Secret</label>
            <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="shpss_..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => m.mutate()}
            disabled={m.isPending || !name.trim() || !domain.trim() || !clientId.trim() || !clientSecret.trim()}>
            {m.isPending && <Loader2 className="size-4 animate-spin" />} Autorizar na Shopify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
