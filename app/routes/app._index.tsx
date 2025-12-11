import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  return (
    <s-page heading="tyz-actions-access">
      <s-section heading="Welcome to the Tryzens Actions Github Application">
        <s-stack>
          <s-text>This embedded app template serves as a connector for the Tryzens Actions Github Application.</s-text>
          <s-text>There are no further features or actions to be taken here.</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
