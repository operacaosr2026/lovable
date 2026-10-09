import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell } from "@/components/PageHeader";
import { ArrowLeft } from "lucide-react";
import { ProductDetails } from "@/components/products/ProductDetails";

export const Route = createFileRoute("/shops/products/$productId")({
  component: ProductDetailPage,
});

function ProductDetailPage() {
  const { productId } = Route.useParams();
  return (
    <PageShell>
      <Link to="/shops/products" search={{ view: "esteira" }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
        <ArrowLeft className="size-4" /> Produtos
      </Link>
      <ProductDetails productId={productId} />
    </PageShell>
  );
}
