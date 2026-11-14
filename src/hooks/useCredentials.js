import { useContext } from "react";
import { credentialsContext } from "../context/credentialsContext";

export default function useCredentials() {
    return useContext(credentialsContext);
}
