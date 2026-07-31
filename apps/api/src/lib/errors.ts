import { ERRORS, type ErrorKey } from "@ciao/shared";

export class CiaoError extends Error {
  constructor(
    public key: ErrorKey,
    public detail?: unknown,
  ) {
    super(ERRORS[key].en);
  }

  toResponse(locale: string = "ar") {
    const def = ERRORS[this.key];
    return {
      error: {
        code: def.code,
        message: locale === "en" ? def.en : def.ar,
        messageAr: def.ar,
        messageEn: def.en,
        detail: this.detail,
      },
    };
  }

  get httpStatus() {
    return ERRORS[this.key].httpStatus;
  }
}
