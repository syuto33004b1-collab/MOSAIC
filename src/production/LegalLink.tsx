import type { ReactNode } from "react";
import { withLegalSearch } from "../legal";

type LegalLinkProps = {
  className?: string;
  children?: ReactNode;
};

export function LegalLink({
  className = "production-legal-link",
  children = "プライバシーポリシーと利用規約",
}: LegalLinkProps) {
  return <a className={className} href={withLegalSearch(window.location)}>{children}</a>;
}
