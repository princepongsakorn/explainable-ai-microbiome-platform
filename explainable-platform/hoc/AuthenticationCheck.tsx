import { useRouter } from "next/router";
import { jwtDecode } from "jwt-decode";
import Cookies from "js-cookie";
import { useEffect, useState } from "react";

interface Props {
  pageProps: {};
}

const AuthenticationCheck = (WrappedComponent: any) => {
  return (props: Props) => {
    const router = useRouter();
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
      setIsClient(true);
    }, []);

    if (!isClient) {
      return null;
    }

    const accessToken = Cookies.get("act");
    if (!accessToken) {
      router.push("/auth/login");
      return null;
    }

    const actDecode: { exp: number } = jwtDecode(accessToken);
    if (Date.now() >= actDecode.exp * 1000) {
      router.push("/403");
      return null;
    }

    return <WrappedComponent {...props} />;
  };
};

export default AuthenticationCheck;
