// Bundle all borders into a single object to avoid multiple requests and support dynamic access
import FRA from "./FRA.json";
import CHE from "./CHE.json";
import QC from "./QC.json";

export const borders = { FRA, CHE, QC };
