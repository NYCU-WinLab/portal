# Signs the base PDFs from `bun run pades:check base` the way a vendor
# would, with pyHanko and a throwaway certificate, so CI can prove that
# our signature is added without breaking theirs. Run in .pades/.
import subprocess

from pyhanko.sign import fields, signers
from pyhanko.sign.fields import MDPPerm
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter

subprocess.run(
    "openssl req -x509 -newkey rsa:2048 -nodes -keyout vendor.key -out vendor.pem"
    " -days 7 -subj '/CN=Vendor (CI)' -addext keyUsage=critical,digitalSignature,nonRepudiation",
    shell=True, check=True, capture_output=True,
)
signer = signers.SimpleSigner.load("vendor.key", "vendor.pem")


def sign(source, target, certify=False, permission=MDPPerm.FILL_FORMS):
    with open(source, "rb") as f, open(target, "wb") as out:
        signers.sign_pdf(
            IncrementalPdfFileWriter(f),
            signers.PdfSignatureMetadata(
                field_name="VendorSig", certify=certify, docmdp_permissions=permission
            ),
            signer=signer,
            output=out,
            new_field_spec=fields.SigFieldSpec("VendorSig", box=(50, 700, 250, 760)),
        )


sign("base-xrefstream.pdf", "vendor-xrefstream.pdf")
sign("base-classic.pdf", "vendor-classic.pdf")
sign("base-xrefstream.pdf", "vendor-certified.pdf", certify=True)
sign("base-classic.pdf", "vendor-locked.pdf", certify=True, permission=MDPPerm.NO_CHANGES)
print("vendor PDFs written")
