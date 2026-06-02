"""Very small, safe placeholder renderer for email-signature templates.

Templates use ``{{ key }}`` placeholders. We deliberately avoid a full
templating engine so user-authored templates can't execute code; unknown
placeholders are simply rendered as an empty string.
"""
import html
import re

PLACEHOLDER = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")


def render_signature(template_html: str, data: dict[str, str]) -> str:
    def replace(match: re.Match) -> str:
        key = match.group(1)
        return html.escape(str(data.get(key, "")))

    return PLACEHOLDER.sub(replace, template_html)


DEFAULT_TEMPLATE = """\
<table style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222">
  <tr>
    <td style="padding-right:16px;border-right:3px solid {{ accent_color }}">
      <img src="{{ photo_url }}" alt="" width="72" height="72"
           style="border-radius:50%;display:block">
    </td>
    <td style="padding-left:16px">
      <div style="font-size:15px;font-weight:bold;color:{{ accent_color }}">
        {{ full_name }}
      </div>
      <div style="color:#555">{{ title }} &middot; {{ department }}</div>
      <div style="margin-top:6px">{{ company }}</div>
      <div style="margin-top:6px">
        <a href="mailto:{{ email }}" style="color:#222;text-decoration:none">
          {{ email }}</a>
        &nbsp;|&nbsp; {{ phone }}
      </div>
      <div style="margin-top:4px">
        <a href="{{ website }}" style="color:{{ accent_color }}">{{ website }}</a>
      </div>
    </td>
  </tr>
</table>
"""
