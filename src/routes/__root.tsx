import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AppSettingsProvider } from "@/lib/app-settings";
import { useLocation, Navigate } from "@tanstack/react-router";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Adam App" },
      { name: "description", content: "Sistema de organização pessoal: tarefas, finanças, projetos, hábitos e ecommerce." },
      { name: "author", content: "Orbit" },
      { property: "og:title", content: "Adam App" },
      { property: "og:description", content: "Sistema de organização pessoal: tarefas, finanças, projetos, hábitos e ecommerce." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Adam App" },
      { name: "twitter:description", content: "Sistema de organização pessoal: tarefas, finanças, projetos, hábitos e ecommerce." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/057932f1-5d47-4b14-93e1-5fce387bb2f7/id-preview-0b20ae55--fc8eaebe-f357-48d4-aa62-e814e4af0c57.lovable.app-1778287220544.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/057932f1-5d47-4b14-93e1-5fce387bb2f7/id-preview-0b20ae55--fc8eaebe-f357-48d4-aa62-e814e4af0c57.lovable.app-1778287220544.png" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppSettingsProvider>
          <AuthGate />
        </AppSettingsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const isLogin = location.pathname === "/login";

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="size-6 rounded-full border-2 border-border border-t-primary animate-spin" />
      </div>
    );
  }

  if (!user && !isLogin) {
    try {
      const here = location.pathname + location.search + (location.hash ?? "");
      if (here && !here.startsWith("/login")) sessionStorage.setItem("redirectAfterLogin", here);
    } catch {}
    return <Navigate to="/login" />;
  }
  if (user && isLogin) {
    let dest = "/";
    try {
      const stored = sessionStorage.getItem("redirectAfterLogin");
      if (stored && !stored.startsWith("/login")) {
        dest = stored;
        sessionStorage.removeItem("redirectAfterLogin");
      }
    } catch {}
    return <Navigate to={dest} />;
  }
  if (isLogin) return <Outlet />;
  return <AppLayout />;
}
