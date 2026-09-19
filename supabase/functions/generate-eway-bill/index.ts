import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { org_id, invoice_id } = await req.json();

    if (!org_id || !invoice_id) {
      return json(
        { success: false, error: "Missing org_id or invoice_id" },
        400
      );
    }

    // Get SBIN credentials
    const gstConfigRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/rest/v1/gst_configuration?org_id=eq.${org_id}`,
      {
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
      }
    );

    const gstConfigData = await gstConfigRes.json();

    if (!gstConfigData || gstConfigData.length === 0) {
      return json(
        { success: false, error: "GST configuration not found" },
        400
      );
    }

    const gstConfig = gstConfigData[0];

    if (!gstConfig.sbin_username || !gstConfig.sbin_api_key) {
      return json(
        { success: false, error: "SBIN credentials not configured" },
        400
      );
    }

    // Get invoice details
    const invoiceRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/rest/v1/gst_invoices?id=eq.${invoice_id}`,
      {
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
      }
    );

    const invoiceData = await invoiceRes.json();

    if (!invoiceData || invoiceData.length === 0) {
      return json({ success: false, error: "Invoice not found" }, 404);
    }

    const invoice = invoiceData[0];

    // Call SBIN API to generate e-way bill
    const ewayBillPayload = {
      action: "GENERATE",
      data: {
        supplyType: "O", // Outward supply
        docType: "INV", // Invoice
        docNo: invoice.invoice_number,
        docDate: invoice.invoice_date,
        fromGstin: gstConfig.gstin,
        toGstin: invoice.consignee_gstin,
        toTradeName: invoice.consignee_name,
        fromTradeName: gstConfig.org_name,
        itemList: [
          {
            itemNo: 1,
            hsn: "996311", // Services
            description: invoice.commodity_description,
            quantity: invoice.quantity_units || 1,
            qtyUnit: invoice.unit_type || "UNT",
            taxableAmount: invoice.taxable_amount,
            gstRate: gstConfig.tax_slab_pct,
            igstAmount: invoice.igst_amount || 0,
            sgstAmount: invoice.sgst_amount || 0,
            cgstAmount: invoice.cgst_amount || 0,
          },
        ],
        vehicleList: [
          {
            vehicleNo: invoice.vehicle_id, // Will be replaced with actual vehicle number
            transDocNo: invoice.invoice_number,
            transDocDate: invoice.invoice_date,
            transMode: "1", // Road
            transDistance: 0,
          },
        ],
        totInvValue: invoice.invoice_total,
      },
    };

    // Call SBIN production API
    const sbinResponse = await fetch("https://ewaybillapi.sbin.co.in/api/genererate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gstConfig.sbin_api_key}`,
      },
      body: JSON.stringify(ewayBillPayload),
    });

    const sbinData = await sbinResponse.json();

    if (sbinData.status === 1 && sbinData.data?.ewayBillNo) {
      const ewayBillNumber = sbinData.data.ewayBillNo;
      const validTill = new Date(sbinData.data.validTill);

      // Update invoice with e-way bill details
      await fetch(
        `${Deno.env.get("SUPABASE_URL")}/rest/v1/gst_invoices?id=eq.${invoice_id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            eway_bill_number: ewayBillNumber,
            eway_bill_generated_at: new Date().toISOString(),
            eway_bill_valid_till: validTill.toISOString(),
          }),
        }
      );

      // Log audit
      await logGSTAudit(org_id, "eway_bill_generated", invoice_id, {
        eway_bill_number: ewayBillNumber,
        valid_till: validTill.toISOString(),
      });

      return json({
        success: true,
        eway_bill_number: ewayBillNumber,
        valid_till: validTill.toISOString(),
        invoice_id: invoice_id,
      });
    } else {
      return json(
        { success: false, error: sbinData.message || "SBIN API error" },
        400
      );
    }
  } catch (error) {
    console.error("E-way Bill Error:", error);
    return json({ success: false, error: error.message }, 500);
  }
});

async function logGSTAudit(
  org_id: string,
  action: string,
  entity_id: string,
  details: Record<string, unknown>
) {
  try {
    await fetch(
      `${Deno.env.get("SUPABASE_URL")}/rest/v1/gst_audit_logs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          org_id,
          action,
          entity_type: "eway_bill",
          entity_id,
          details,
          created_at: new Date().toISOString(),
        }),
      }
    );
  } catch (e) {
    console.error("Audit log error:", e);
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
